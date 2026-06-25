import { readFileSync } from 'node:fs';
import { StrKey, TransactionBuilder, nativeToScVal, scValToNative } from '@stellar/stellar-sdk';
import { describe, expect, it, vi } from 'vitest';
import {
  parseEnumeratedCreditLinesScVal,
  StellarSorobanClient,
} from '../sorobanClient.js';

interface ContractInterfaceFixture {
  source: {
    repository: string;
    commit: string;
    contract: string;
    sourceRefs: string[];
  };
  method: {
    name: string;
    arguments: Array<{ name: string; type: string; maximum?: number }>;
    returnType: string;
  };
  cursor: { type: string };
  creditLineData: {
    fieldOrder: Array<{ name: string; type: string }>;
  };
  creditStatus: Record<string, number>;
}

const fixture = JSON.parse(
  readFileSync(
    new URL('../__fixtures__/soroban/credit-contract-interface.v1.json', import.meta.url),
    'utf8',
  ),
) as ContractInterfaceFixture;

const TEST_CONTRACT_ID = StrKey.encodeContract(Buffer.alloc(32, 1));
const TEST_CONFIG = {
  rpcUrl: 'https://soroban-testnet.stellar.org',
  contractId: TEST_CONTRACT_ID,
  networkPassphrase: 'Test SDF Network ; September 2015',
};
const TEST_RPC_CONFIG = {
  rpcUrl: TEST_CONFIG.rpcUrl,
  networkPassphrase: TEST_CONFIG.networkPassphrase,
  timeoutMs: 50,
  maxRetries: 0,
  retryJitterMs: 0,
};

function publicKeyFromSeed(seed: number): string {
  const bytes = Buffer.alloc(32);
  bytes.writeUInt32BE(seed);
  return StrKey.encodeEd25519PublicKey(bytes);
}

function pageXdr(value: unknown): string {
  return nativeToScVal(value).toXDR('base64');
}

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200, statusText: 'OK' });
}

function contractCreditLineTuple(seed: number, statusDiscriminant: number): unknown[] {
  return [
    publicKeyFromSeed(seed),
    '10000.0000000',
    '2500.0000000',
    425,
    70,
    statusDiscriminant,
    0,
    0,
    0,
    0,
  ];
}

function invocationFromFetchCall(fetchImpl: ReturnType<typeof vi.fn>, callIndex: number) {
  const body = JSON.parse(String(fetchImpl.mock.calls[callIndex]?.[1]?.body)) as {
    params: { transaction: string };
  };
  const transaction = TransactionBuilder.fromXDR(body.params.transaction, TEST_CONFIG.networkPassphrase);
  const operation = transaction.operations[0];
  if (!operation || operation.type !== 'invokeHostFunction') {
    throw new Error('expected invokeHostFunction operation');
  }

  const invocation = operation.func.invokeContract();

  return {
    functionName: invocation.functionName().toString(),
    args: invocation.args().map(scValToNative),
  };
}

describe('Credit contract compatibility fixture', () => {
  it('pins the contract source and enumerate_credit_lines ABI used by reconciliation', () => {
    expect(fixture.source).toMatchObject({
      repository: 'Creditra/Creditra-Contracts',
      commit: '3f3ef2f318641005e3b2fb970df8e54f927ce606',
      contract: 'contracts/credit',
    });
    expect(fixture.source.sourceRefs).toEqual(
      expect.arrayContaining([
        'contracts/credit/src/lib.rs',
        'contracts/credit/src/types.rs',
        'contracts/credit/src/storage.rs',
        'contracts/credit/tests/enumerate_credit_lines.rs',
      ]),
    );
    expect(fixture.method).toMatchObject({
      name: 'enumerate_credit_lines',
      returnType: 'Vec<(u32, CreditLineData)>',
    });
    expect(fixture.method.arguments).toEqual([
      expect.objectContaining({ name: 'start_after', type: 'Option<u32>' }),
      expect.objectContaining({ name: 'limit', type: 'u32', maximum: 100 }),
    ]);
    expect(fixture.cursor.type).toBe('u32');
    expect(fixture.creditLineData.fieldOrder.map((field) => field.name)).toEqual([
      'borrower',
      'credit_limit',
      'utilized_amount',
      'interest_rate_bps',
      'risk_score',
      'status',
      'last_rate_update_ts',
      'accrued_interest',
      'last_accrual_ts',
      'suspension_ts',
    ]);
    expect(fixture.creditStatus).toEqual({
      Active: 0,
      Suspended: 1,
      Defaulted: 2,
      Closed: 3,
      Restricted: 4,
    });
  });

  it('builds the exact contract method and pagination arguments from the fixture', async () => {
    const limit = fixture.method.arguments[1]?.maximum ?? 100;
    const firstPage = Array.from({ length: limit }, (_value, index) => [
      index,
      contractCreditLineTuple(index + 1, fixture.creditStatus['Active'] ?? 0),
    ]);
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ result: { results: [{ xdr: pageXdr(firstPage) }] } }))
      .mockResolvedValueOnce(jsonResponse({ result: { results: [{ xdr: pageXdr([]) }] } }));
    const client = new StellarSorobanClient(
      TEST_CONFIG,
      TEST_RPC_CONFIG,
      fetchImpl as unknown as typeof fetch,
      { sleep: vi.fn().mockResolvedValue(undefined), random: () => 0 },
    );

    await expect(client.fetchAllCreditRecords()).resolves.toHaveLength(limit);

    expect(invocationFromFetchCall(fetchImpl, 0)).toEqual({
      functionName: fixture.method.name,
      args: [null, limit],
    });
    expect(invocationFromFetchCall(fetchImpl, 1)).toEqual({
      functionName: fixture.method.name,
      args: [limit - 1, limit],
    });
  });

  it('decodes the contract CreditLineData tuple field order, including risk_score before status', () => {
    const statusEntries = Object.entries(fixture.creditStatus).map(([statusName, discriminant], index) => [
      index,
      contractCreditLineTuple(index + 1, discriminant),
      statusName.toLowerCase(),
    ]);

    const records = parseEnumeratedCreditLinesScVal(
      nativeToScVal(statusEntries.map(([cursor, tuple]) => [cursor, tuple])),
    );

    expect(records).toEqual(
      statusEntries.map(([cursor, _tuple, status], index) => ({
        id: String(cursor),
        walletAddress: publicKeyFromSeed(index + 1),
        creditLimit: '10000.0000000',
        availableCredit: '7500.0000000',
        interestRateBps: 425,
        status,
      })),
    );
  });
});
