import {
  Account,
  BASE_FEE,
  Contract,
  StrKey,
  TransactionBuilder,
  nativeToScVal,
  scValToNative,
  xdr,
} from '@stellar/stellar-sdk';
import type { OnChainCreditRecord, SorobanRpcClient } from './reconciliationService.js';
import { resolveSorobanRpcConfig, type SorobanRpcConfig } from './sorobanRpcClient.js';
import { sanitizeStellarDiagnostic } from './stellarDiagnostics.js';

const DEFAULT_RPC_URL = 'https://soroban-testnet.stellar.org';
const DEFAULT_NETWORK_PASSPHRASE = 'Test SDF Network ; September 2015';
const ENUMERATE_CREDIT_LINES_METHOD = 'enumerate_credit_lines';
const SIMULATION_SOURCE_ACCOUNT = 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF';
const ENUMERATION_PAGE_LIMIT = 100;
const MAX_ENUMERATED_CREDIT_RECORDS = 10_000;
const BASE_RETRY_DELAY_MS = 1_000;
const MAX_RETRY_POWER = 10;
const DECIMAL_STRING_REGEX = /^-?\d+(?:\.\d+)?$/;
// Must match the Credit contract enum discriminants for CreditLineStatus.
const CREDIT_STATUS_BY_CONTRACT_DISCRIMINANT: Record<number, string> = {
  0: 'active',
  1: 'suspended',
  2: 'defaulted',
  3: 'closed',
  4: 'restricted',
};

interface JsonRpcResponse<T> {
  result?: T;
  error?: unknown;
}

interface RetryRuntime {
  sleep(ms: number): Promise<void>;
  random(): number;
}

interface EnumeratedCreditRecord extends OnChainCreditRecord {
  cursor: number;
}

export interface SorobanClientConfig {
  rpcUrl: string;
  contractId: string;
  networkPassphrase: string;
}

export class SorobanCreditRecordDecodeError extends Error {
  constructor(message: string) {
    super(sanitizeStellarDiagnostic(message));
    this.name = 'SorobanCreditRecordDecodeError';
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

class SorobanCreditRecordFetchError extends Error {
  constructor(
    message: string,
    readonly retryable = true,
  ) {
    super(sanitizeStellarDiagnostic(message));
    this.name = 'SorobanCreditRecordFetchError';
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/** Test and local-development fallback used when CREDIT_CONTRACT_ID is empty. */
export class MockSorobanClient implements SorobanRpcClient {
  constructor(private readonly config: SorobanClientConfig) {}

  async fetchAllCreditRecords(): Promise<OnChainCreditRecord[]> {
    console.log('[MockSorobanClient] CREDIT_CONTRACT_ID is empty; returning no on-chain credit records.', {
      rpcUrl: sanitizeStellarDiagnostic(this.config.rpcUrl),
    });

    return [];
  }
}

export class StellarSorobanClient implements SorobanRpcClient {
  private readonly config: SorobanClientConfig;
  private readonly rpcConfig: Required<Pick<SorobanRpcConfig, 'timeoutMs' | 'maxRetries' | 'retryJitterMs'>>;
  private readonly fetchImpl: typeof fetch;
  private readonly runtime: RetryRuntime;

  constructor(
    config: SorobanClientConfig = resolveSorobanConfig(),
    rpcConfig: SorobanRpcConfig = resolveSorobanRpcConfig(),
    fetchImpl: typeof fetch = fetch,
    runtime: RetryRuntime = defaultRetryRuntime,
  ) {
    this.config = normalizeSorobanClientConfig(config);
    this.rpcConfig = {
      timeoutMs: positiveIntegerOrDefault(rpcConfig.timeoutMs, 30_000),
      maxRetries: nonNegativeIntegerOrDefault(rpcConfig.maxRetries, 3),
      retryJitterMs: nonNegativeIntegerOrDefault(rpcConfig.retryJitterMs, 1_000),
    };
    this.fetchImpl = fetchImpl;
    this.runtime = runtime;
  }

  async fetchAllCreditRecords(): Promise<OnChainCreditRecord[]> {
    if (!this.config.contractId) {
      return [];
    }

    if (!StrKey.isValidContract(this.config.contractId)) {
      throw new SorobanCreditRecordFetchError('Invalid CREDIT_CONTRACT_ID; expected a C... contract id', false);
    }

    const records: EnumeratedCreditRecord[] = [];
    let startAfter: number | undefined;

    for (;;) {
      const page = await this.fetchCreditRecordPage(startAfter);
      records.push(...page);

      if (records.length > MAX_ENUMERATED_CREDIT_RECORDS) {
        throw new SorobanCreditRecordDecodeError(
          `Soroban enumeration exceeded ${MAX_ENUMERATED_CREDIT_RECORDS} credit records`,
        );
      }

      if (page.length < ENUMERATION_PAGE_LIMIT) {
        break;
      }

      const nextStartAfter = page[page.length - 1]?.cursor;
      if (nextStartAfter === undefined) {
        throw new SorobanCreditRecordDecodeError('Soroban enumeration page did not expose a cursor');
      }
      if (startAfter !== undefined && nextStartAfter <= startAfter) {
        throw new SorobanCreditRecordDecodeError('Soroban enumeration cursor did not advance');
      }

      startAfter = nextStartAfter;
    }

    assertUniqueBorrowers(records);
    return records.map(({ cursor: _cursor, ...record }) => record);
  }

  private async fetchCreditRecordPage(startAfter: number | undefined): Promise<EnumeratedCreditRecord[]> {
    const returnValue = await this.withRetry(async () => {
      const simulation = await this.postJsonRpc('simulateTransaction', {
        transaction: this.buildEnumerationTransaction(startAfter).toXDR(),
      });
      return extractSimulationReturnValue(simulation);
    });

    return parseEnumeratedCreditLineEntriesScVal(returnValue);
  }

  private buildEnumerationTransaction(startAfter: number | undefined) {
    const source = new Account(SIMULATION_SOURCE_ACCOUNT, '0');
    const startAfterArg = startAfter === undefined
      ? nativeToScVal(null)
      : nativeToScVal(startAfter, { type: 'u32' });

    return new TransactionBuilder(source, {
      fee: BASE_FEE,
      networkPassphrase: this.config.networkPassphrase,
    })
      .addOperation(
        new Contract(this.config.contractId).call(
          ENUMERATE_CREDIT_LINES_METHOD,
          startAfterArg,
          nativeToScVal(ENUMERATION_PAGE_LIMIT, { type: 'u32' }),
        ),
      )
      .setTimeout(Math.max(1, Math.ceil(this.rpcConfig.timeoutMs / 1_000)))
      .build();
  }

  private async postJsonRpc(method: string, params: Record<string, unknown>): Promise<unknown> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.rpcConfig.timeoutMs);

    try {
      const response = await this.fetchImpl(this.config.rpcUrl, {
        method: 'POST',
        headers: { accept: 'application/json', 'content-type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
        signal: controller.signal,
      });
      const responseBody = await response.text();

      if (!response.ok) {
        throw new SorobanCreditRecordFetchError(
          `Soroban RPC HTTP ${response.status} ${response.statusText}: ${responseBody}`,
          isRetryableHttpStatus(response.status),
        );
      }

      const payload = parseJsonRpcResponse(responseBody, method);
      if (payload.error !== undefined) {
        throw new SorobanCreditRecordFetchError(
          `Soroban RPC ${method} failed: ${sanitizeStellarDiagnostic(payload.error)}`,
          isRetryableJsonRpcError(payload.error),
        );
      }

      if (!Object.prototype.hasOwnProperty.call(payload, 'result')) {
        throw new SorobanCreditRecordFetchError(`Soroban RPC ${method} response missing result`, false);
      }

      return payload.result;
    } catch (error) {
      if (controller.signal.aborted) {
        throw new SorobanCreditRecordFetchError(`Soroban RPC timed out after ${this.rpcConfig.timeoutMs}ms`);
      }

      throw toSorobanError(error);
    } finally {
      clearTimeout(timeout);
    }
  }

  private async withRetry<T>(operation: () => Promise<T>): Promise<T> {
    let lastError: Error = new SorobanCreditRecordFetchError('Unknown Soroban RPC failure');

    for (let attempt = 0; attempt <= this.rpcConfig.maxRetries; attempt += 1) {
      try {
        return await operation();
      } catch (error) {
        lastError = toSorobanError(error);

        if (lastError instanceof SorobanCreditRecordDecodeError) {
          throw lastError;
        }

        if (lastError instanceof SorobanCreditRecordFetchError && !lastError.retryable) {
          throw lastError;
        }

        if (attempt === this.rpcConfig.maxRetries) {
          throw lastError;
        }

        await this.runtime.sleep(calculateRetryDelayMs(attempt, this.rpcConfig.retryJitterMs, this.runtime));
      }
    }

    throw lastError;
  }
}

export function createSorobanClient(
  config: SorobanClientConfig = resolveSorobanConfig(),
  rpcConfig: SorobanRpcConfig = resolveSorobanRpcConfig(),
): SorobanRpcClient {
  const normalizedConfig = normalizeSorobanClientConfig(config);

  if (!normalizedConfig.contractId) {
    return new MockSorobanClient(normalizedConfig);
  }

  return new StellarSorobanClient(normalizedConfig, rpcConfig);
}

export function resolveSorobanConfig(): SorobanClientConfig {
  return {
    rpcUrl: process.env['SOROBAN_RPC_URL'] ?? DEFAULT_RPC_URL,
    contractId: process.env['CREDIT_CONTRACT_ID'] ?? '',
    networkPassphrase: process.env['STELLAR_NETWORK_PASSPHRASE'] ?? DEFAULT_NETWORK_PASSPHRASE,
  };
}

export function parseEnumeratedCreditLinesScVal(scVal: xdr.ScVal | string): OnChainCreditRecord[] {
  const records = parseEnumeratedCreditLineEntriesScVal(scVal);
  assertUniqueBorrowers(records);
  return records.map(({ cursor: _cursor, ...record }) => record);
}

function parseEnumeratedCreditLineEntriesScVal(scVal: xdr.ScVal | string): EnumeratedCreditRecord[] {
  const nativeValue = decodeScVal(scVal);

  if (!Array.isArray(nativeValue)) {
    throw new SorobanCreditRecordDecodeError('enumerate_credit_lines result must be an array');
  }

  return nativeValue.map((entry, index) => parseEnumeratedEntry(entry, index));
}

function decodeScVal(scVal: xdr.ScVal | string): unknown {
  try {
    const value = typeof scVal === 'string' ? xdr.ScVal.fromXDR(scVal, 'base64') : scVal;
    return scValToNative(value);
  } catch (error) {
    throw new SorobanCreditRecordDecodeError(
      `Could not decode enumerate_credit_lines ScVal: ${sanitizeStellarDiagnostic(error)}`,
    );
  }
}

function parseEnumeratedEntry(entry: unknown, index: number): EnumeratedCreditRecord {
  const tuple = readEnumerationTuple(entry, index);
  const cursor = toSafeInteger(tuple[0], index, 'cursor');
  const record = parseCreditLineData(tuple[1], index);

  return {
    id: String(cursor),
    walletAddress: record.walletAddress,
    creditLimit: record.creditLimit,
    availableCredit: subtractDecimalStrings(record.creditLimit, record.utilizedAmount),
    interestRateBps: record.interestRateBps,
    status: record.status,
    cursor,
  };
}

function readEnumerationTuple(entry: unknown, index: number): [unknown, unknown] {
  if (Array.isArray(entry) && entry.length >= 2) {
    return [entry[0], entry[1]];
  }

  if (isRecord(entry)) {
    const cursor = readOptionalField(entry, ['id', 'cursor', 'creditLineId', 'credit_line_id']);
    const record = readOptionalField(entry, ['record', 'line', 'creditLine', 'credit_line']);

    if (cursor !== undefined && record !== undefined) {
      return [cursor, record];
    }
  }

  throw new SorobanCreditRecordDecodeError(`enumerate_credit_lines entry ${index} must be an id/record tuple`);
}

function parseCreditLineData(value: unknown, index: number): {
  walletAddress: string;
  creditLimit: string;
  utilizedAmount: string;
  interestRateBps: number;
  status: string;
} {
  return {
    walletAddress: toBorrowerPublicKey(
      readField(value, ['borrower', 'walletAddress', 'wallet_address'], 0, index),
      index,
    ),
    creditLimit: toPreciseDecimalString(
      readField(value, ['credit_limit', 'creditLimit', 'limit'], 1, index),
      index,
      'creditLimit',
    ),
    utilizedAmount: toPreciseDecimalString(
      readField(value, ['utilized_amount', 'utilizedAmount', 'utilized'], 2, index),
      index,
      'utilizedAmount',
    ),
    interestRateBps: toSafeInteger(
      readField(value, ['interest_rate_bps', 'interestRateBps', 'interestRate'], 3, index),
      index,
      'interestRateBps',
    ),
    status: normalizeCreditStatus(readField(value, ['status'], 4, index), index),
  };
}

function readField(value: unknown, fieldNames: string[], tupleIndex: number, recordIndex: number): unknown {
  if (Array.isArray(value) && tupleIndex < value.length) {
    return value[tupleIndex];
  }

  const namedValue = readOptionalField(value, fieldNames);
  if (namedValue !== undefined) {
    return namedValue;
  }

  throw new SorobanCreditRecordDecodeError(
    `Credit line ${recordIndex} is missing ${fieldNames[0] ?? 'required field'}`,
  );
}

function readOptionalField(value: unknown, fieldNames: string[]): unknown {
  if (value instanceof Map) {
    for (const [key, entryValue] of value.entries()) {
      if (fieldNames.includes(String(key))) {
        return entryValue;
      }
    }
  }

  if (!isRecord(value)) {
    return undefined;
  }

  for (const fieldName of fieldNames) {
    if (Object.prototype.hasOwnProperty.call(value, fieldName)) {
      return value[fieldName];
    }
  }

  return undefined;
}

function toNonEmptyString(value: unknown, index: number, field: string): string {
  if (typeof value !== 'string') {
    throw new SorobanCreditRecordDecodeError(`Credit line ${index} field ${field} must be a string`);
  }

  const stringValue = value.trim();

  if (stringValue.length === 0) {
    throw new SorobanCreditRecordDecodeError(`Credit line ${index} field ${field} must be non-empty`);
  }

  return stringValue;
}

function toBorrowerPublicKey(value: unknown, index: number): string {
  const walletAddress = toNonEmptyString(value, index, 'borrower');

  if (!StrKey.isValidEd25519PublicKey(walletAddress)) {
    throw new SorobanCreditRecordDecodeError(`Credit line ${index} borrower must be a valid Stellar public key`);
  }

  return walletAddress;
}

function toPreciseDecimalString(value: unknown, index: number, field: string): string {
  if (typeof value === 'string') {
    const trimmed = value.trim();

    if (!DECIMAL_STRING_REGEX.test(trimmed)) {
      throw new SorobanCreditRecordDecodeError(`Credit line ${index} field ${field} was not a decimal string`);
    }

    return trimmed;
  }

  if (typeof value === 'bigint') {
    return value.toString();
  }

  if (typeof value === 'number' && Number.isSafeInteger(value)) {
    return value.toString();
  }

  throw new SorobanCreditRecordDecodeError(
    `Credit line ${index} field ${field} was not a string-precise numeric value`,
  );
}

function toSafeInteger(value: unknown, index: number, field: string): number {
  let parsed: number | undefined;

  if (typeof value === 'number' && Number.isSafeInteger(value)) {
    parsed = value;
  } else if (typeof value === 'bigint') {
    parsed = value <= BigInt(Number.MAX_SAFE_INTEGER) && value >= BigInt(Number.MIN_SAFE_INTEGER)
      ? Number(value)
      : undefined;
  } else if (typeof value === 'string' && /^-?\d+$/.test(value)) {
    const asNumber = Number(value);
    parsed = Number.isSafeInteger(asNumber) ? asNumber : undefined;
  }

  if (parsed === undefined) {
    throw new SorobanCreditRecordDecodeError(`Credit line ${index} field ${field} must be a safe integer`);
  }

  return parsed;
}

function normalizeCreditStatus(value: unknown, index: number): string {
  if (typeof value === 'number' && Number.isSafeInteger(value)) {
    return contractStatusFromDiscriminant(value, index);
  }

  if (typeof value === 'bigint') {
    if (value < 0n || value > BigInt(Number.MAX_SAFE_INTEGER)) {
      throw new SorobanCreditRecordDecodeError(`Credit line ${index} status ${value.toString()} is not a recognized contract status`);
    }

    return contractStatusFromDiscriminant(Number(value), index);
  }

  if (isRecord(value) && typeof value['tag'] === 'string') {
    return normalizeStatusString(value['tag']);
  }

  return normalizeStatusString(toNonEmptyString(value, index, 'status'));
}

function normalizeStatusString(value: string): string {
  return value.replace(/([a-z0-9])([A-Z])/g, '$1_$2').replace(/[\s-]+/g, '_').toLowerCase();
}

function contractStatusFromDiscriminant(value: number, index: number): string {
  const status = CREDIT_STATUS_BY_CONTRACT_DISCRIMINANT[value];

  if (status === undefined) {
    throw new SorobanCreditRecordDecodeError(
      `Credit line ${index} status ${value} is not a recognized contract status`,
    );
  }

  return status;
}

function subtractDecimalStrings(left: string, right: string): string {
  const leftParts = parseDecimal(left);
  const rightParts = parseDecimal(right);
  const scale = Math.max(leftParts.scale, rightParts.scale);
  const leftValue = leftParts.value * 10n ** BigInt(scale - leftParts.scale);
  const rightValue = rightParts.value * 10n ** BigInt(scale - rightParts.scale);
  const difference = leftValue - rightValue;
  const negative = difference < 0n;
  const magnitude = negative ? -difference : difference;
  const raw = magnitude.toString().padStart(scale + 1, '0');

  if (scale === 0) {
    return `${negative ? '-' : ''}${raw}`;
  }

  const whole = raw.slice(0, -scale);
  const fraction = raw.slice(-scale);
  return `${negative ? '-' : ''}${whole}.${fraction}`;
}

function parseDecimal(value: string): { value: bigint; scale: number } {
  if (!DECIMAL_STRING_REGEX.test(value)) {
    throw new SorobanCreditRecordDecodeError(`Cannot subtract non-decimal value ${value}`);
  }

  const negative = value.startsWith('-');
  const unsigned = negative ? value.slice(1) : value;
  const [whole, fraction = ''] = unsigned.split('.');
  const magnitude = BigInt(`${whole}${fraction}`);
  return {
    value: negative ? -magnitude : magnitude,
    scale: fraction.length,
  };
}

function extractSimulationReturnValue(simulation: unknown): xdr.ScVal | string {
  const direct = readOptionalField(simulation, ['retval', 'returnValue', 'xdr']);
  if (isScValOrXdrString(direct)) {
    return direct;
  }

  const result = readOptionalField(simulation, ['result']);
  const nested = readOptionalField(result, ['retval', 'returnValue', 'xdr']);
  if (isScValOrXdrString(nested)) {
    return nested;
  }

  const results = readOptionalField(simulation, ['results']);
  if (Array.isArray(results) && results.length > 0) {
    const firstResult = results[0];
    const resultXdr = readOptionalField(firstResult, ['xdr', 'retval']);
    if (isScValOrXdrString(resultXdr)) {
      return resultXdr;
    }
  }

  throw new SorobanCreditRecordDecodeError('Soroban simulation did not return enumerate_credit_lines XDR');
}

function isScValOrXdrString(value: unknown): value is xdr.ScVal | string {
  return typeof value === 'string' || value instanceof xdr.ScVal;
}

function parseJsonRpcResponse(responseBody: string, method: string): JsonRpcResponse<unknown> {
  try {
    return JSON.parse(responseBody) as JsonRpcResponse<unknown>;
  } catch (error) {
    throw new SorobanCreditRecordFetchError(
      `Soroban RPC ${method} returned malformed JSON: ${sanitizeStellarDiagnostic(error)}`,
      false,
    );
  }
}

function isRetryableJsonRpcError(error: unknown): boolean {
  const code = isRecord(error) ? error['code'] : undefined;
  return typeof code === 'number' ? code === -32000 || code === -32001 || code === -32002 : true;
}

function isRetryableHttpStatus(status: number): boolean {
  return status === 408 || status === 409 || status === 425 || status === 429 || status >= 500;
}

function calculateRetryDelayMs(attempt: number, retryJitterMs: number, runtime: RetryRuntime): number {
  const boundedAttempt = Math.min(attempt, MAX_RETRY_POWER);
  const jitterMs = Math.floor(runtime.random() * retryJitterMs);
  return BASE_RETRY_DELAY_MS * 2 ** boundedAttempt + jitterMs;
}

function toSorobanError(error: unknown): Error {
  if (error instanceof SorobanCreditRecordDecodeError || error instanceof SorobanCreditRecordFetchError) {
    return error;
  }

  if (error instanceof Error) {
    return new SorobanCreditRecordFetchError(error.message, isRetryableError(error));
  }

  return new SorobanCreditRecordFetchError(sanitizeStellarDiagnostic(error), false);
}

function isRetryableError(error: Error): boolean {
  const code = (error as Error & { code?: unknown }).code;
  const nameOrCode = typeof code === 'string' ? code.toUpperCase() : error.name.toUpperCase();
  return ['ABORTERROR', 'ECONNABORTED', 'ECONNRESET', 'ETIMEDOUT', 'EPIPE', 'ENETDOWN', 'ENETRESET'].includes(
    nameOrCode,
  );
}

function assertUniqueBorrowers(records: OnChainCreditRecord[]): void {
  const seen = new Set<string>();

  for (const record of records) {
    if (seen.has(record.walletAddress)) {
      throw new SorobanCreditRecordDecodeError(`Duplicate borrower ${record.walletAddress} in Soroban enumeration`);
    }

    seen.add(record.walletAddress);
  }
}

function normalizeSorobanClientConfig(config: SorobanClientConfig): SorobanClientConfig {
  return {
    rpcUrl: trimOrDefault(config.rpcUrl, DEFAULT_RPC_URL),
    contractId: config.contractId.trim(),
    networkPassphrase: trimOrDefault(config.networkPassphrase, DEFAULT_NETWORK_PASSPHRASE),
  };
}

function trimOrDefault(value: string, fallback: string): string {
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : fallback;
}

function positiveIntegerOrDefault(value: number | undefined, fallback: number): number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0 ? value : fallback;
}

function nonNegativeIntegerOrDefault(value: number | undefined, fallback: number): number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : fallback;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

const defaultRetryRuntime: RetryRuntime = {
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  random: () => Math.random(),
};
