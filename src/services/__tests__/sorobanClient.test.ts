import { StrKey, TransactionBuilder, nativeToScVal, scValToNative } from '@stellar/stellar-sdk';
import { describe, expect, it, vi } from 'vitest';
import {
  createSorobanClient,
  MockSorobanClient,
  parseEnumeratedCreditLinesScVal,
  resolveSorobanConfig,
  SorobanCreditRecordDecodeError,
  StellarSorobanClient,
} from '../sorobanClient.js';

const TEST_PUBLIC_KEY = publicKeyFromSeed(1);
const TEST_SECRET_KEY = StrKey.encodeEd25519SecretSeed(Buffer.alloc(32, 2));
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

function pageXdr(value: unknown): string {
  return nativeToScVal(value).toXDR('base64');
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, statusText: status === 200 ? 'OK' : 'failed' });
}

function publicKeyFromSeed(seed: number): string {
  const bytes = Buffer.alloc(32);
  bytes.writeUInt32BE(seed);
  return StrKey.encodeEd25519PublicKey(bytes);
}

function creditEntry(cursor: number, borrower = publicKeyFromSeed(cursor + 10)): unknown[] {
  return [
    cursor,
    {
      borrower,
      credit_limit: '10000.0000000',
      utilized_amount: '2500.0000000',
      interest_rate_bps: 425,
      status: 'Active',
    },
  ];
}

function invocationArgsFromFetchCall(fetchImpl: ReturnType<typeof vi.fn>, callIndex: number): unknown[] {
  const body = JSON.parse(String(fetchImpl.mock.calls[callIndex]?.[1]?.body)) as { params: { transaction: string } };
  const transaction = TransactionBuilder.fromXDR(body.params.transaction, TEST_CONFIG.networkPassphrase);
  const operation = transaction.operations[0];
  if (!operation || operation.type !== 'invokeHostFunction') {
    throw new Error('expected invokeHostFunction operation');
  }

  return operation.func.invokeContract().args().map(scValToNative);
}

describe('resolveSorobanConfig', () => {
  it('uses documented defaults when env vars are absent', () => {
    const previousEnv = { ...process.env };
    delete process.env['SOROBAN_RPC_URL'];
    delete process.env['CREDIT_CONTRACT_ID'];
    delete process.env['STELLAR_NETWORK_PASSPHRASE'];

    try {
      expect(resolveSorobanConfig()).toEqual({
        rpcUrl: 'https://soroban-testnet.stellar.org',
        contractId: '',
        networkPassphrase: 'Test SDF Network ; September 2015',
      });
    } finally {
      process.env = previousEnv;
    }
  });
});

describe('createSorobanClient', () => {
  it('falls back to MockSorobanClient when CREDIT_CONTRACT_ID is empty', () => {
    expect(createSorobanClient({ ...TEST_CONFIG, contractId: '   ' }, TEST_RPC_CONFIG)).toBeInstanceOf(
      MockSorobanClient,
    );
  });

  it('selects StellarSorobanClient when CREDIT_CONTRACT_ID is set', () => {
    expect(createSorobanClient(TEST_CONFIG, TEST_RPC_CONFIG)).toBeInstanceOf(StellarSorobanClient);
  });
});

describe('MockSorobanClient', () => {
  it('returns an empty record set for local and test environments', async () => {
    const consoleLog = vi.spyOn(console, 'log').mockImplementation(() => undefined);

    try {
      await expect(new MockSorobanClient({ ...TEST_CONFIG, contractId: '' }).fetchAllCreditRecords()).resolves.toEqual(
        [],
      );
      expect(consoleLog).toHaveBeenCalledWith(expect.stringContaining('CREDIT_CONTRACT_ID is empty'), {
        rpcUrl: TEST_CONFIG.rpcUrl,
      });
    } finally {
      consoleLog.mockRestore();
    }
  });
});

describe('StellarSorobanClient', () => {
  it('simulates enumerate_credit_lines and decodes the contract-native page shape', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse({
        result: {
          results: [
            {
              xdr: pageXdr([
                [
                  0,
                  {
                    borrower: TEST_PUBLIC_KEY,
                    credit_limit: '10000.0000000',
                    utilized_amount: '2500.0000000',
                    interest_rate_bps: 425,
                    status: 'Active',
                  },
                ],
              ]),
            },
          ],
        },
      }),
    );
    const client = new StellarSorobanClient(TEST_CONFIG, TEST_RPC_CONFIG, fetchImpl as unknown as typeof fetch, {
      sleep: vi.fn().mockResolvedValue(undefined),
      random: () => 0,
    });

    await expect(client.fetchAllCreditRecords()).resolves.toEqual([
      {
        id: '0',
        walletAddress: TEST_PUBLIC_KEY,
        creditLimit: '10000.0000000',
        availableCredit: '7500.0000000',
        interestRateBps: 425,
        status: 'active',
      },
    ]);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(JSON.parse(String(fetchImpl.mock.calls[0]?.[1]?.body))).toMatchObject({
      method: 'simulateTransaction',
    });
  });

  it('follows full pages by passing the last numeric cursor as start_after', async () => {
    const firstPage = Array.from({ length: 100 }, (_value, index) => creditEntry(index));
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({
          result: {
            results: [{ xdr: pageXdr(firstPage) }],
          },
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          result: {
            results: [{ xdr: pageXdr([creditEntry(100)]) }],
          },
        }),
      );
    const client = new StellarSorobanClient(TEST_CONFIG, TEST_RPC_CONFIG, fetchImpl as unknown as typeof fetch, {
      sleep: vi.fn().mockResolvedValue(undefined),
      random: () => 0,
    });

    const records = await client.fetchAllCreditRecords();

    expect(records).toHaveLength(101);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(invocationArgsFromFetchCall(fetchImpl, 0)).toEqual([null, 100]);
    expect(invocationArgsFromFetchCall(fetchImpl, 1)).toEqual([99, 100]);
  });

  it('rejects invalid contract ids before posting RPC', async () => {
    const fetchImpl = vi.fn();
    const client = new StellarSorobanClient(
      { ...TEST_CONFIG, contractId: 'CINVALID' },
      TEST_RPC_CONFIG,
      fetchImpl as unknown as typeof fetch,
    );

    await expect(client.fetchAllCreditRecords()).rejects.toThrow('Invalid CREDIT_CONTRACT_ID');
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('redacts Stellar public and secret keys from thrown error strings', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(jsonResponse({ error: `failed for ${TEST_PUBLIC_KEY} using ${TEST_SECRET_KEY}` }));
    const client = new StellarSorobanClient(TEST_CONFIG, TEST_RPC_CONFIG, fetchImpl as unknown as typeof fetch);

    let thrown: unknown;
    try {
      await client.fetchAllCreditRecords();
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(Error);
    const message = (thrown as Error).message;
    expect(message).toContain('[REDACTED_STELLAR_PUBLIC_KEY]');
    expect(message).toContain('[REDACTED_STELLAR_SECRET_KEY]');
    expect(message).not.toContain(TEST_PUBLIC_KEY);
    expect(message).not.toContain(TEST_SECRET_KEY);
  });

  it('retries retryable RPC failures with exponential backoff and jitter', async () => {
    const sleep = vi.fn().mockResolvedValue(undefined);
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ error: { code: -32000, message: 'temporary unavailable' } }))
      .mockResolvedValueOnce(
        jsonResponse({
          result: {
            results: [{ xdr: pageXdr([creditEntry(0, TEST_PUBLIC_KEY)]) }],
          },
        }),
      );
    const client = new StellarSorobanClient(
      TEST_CONFIG,
      { ...TEST_RPC_CONFIG, maxRetries: 2, retryJitterMs: 10 },
      fetchImpl as unknown as typeof fetch,
      { sleep, random: () => 0.5 },
    );

    await expect(client.fetchAllCreditRecords()).resolves.toHaveLength(1);

    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledWith(1005);
  });

  it('does not retry typed decode failures', async () => {
    const sleep = vi.fn().mockResolvedValue(undefined);
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ result: { results: [] } }));
    const client = new StellarSorobanClient(
      TEST_CONFIG,
      { ...TEST_RPC_CONFIG, maxRetries: 2 },
      fetchImpl as unknown as typeof fetch,
      { sleep, random: () => 0 },
    );

    await expect(client.fetchAllCreditRecords()).rejects.toThrow(SorobanCreditRecordDecodeError);

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
  });

  it('rejects full pages whose cursor does not advance', async () => {
    const firstPage = Array.from({ length: 100 }, (_value, index) => creditEntry(index));
    const nonAdvancingPage = Array.from({ length: 100 }, (_value, index) => creditEntry(100 + index));
    nonAdvancingPage[99] = creditEntry(99, publicKeyFromSeed(9999));
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({
          result: {
            results: [{ xdr: pageXdr(firstPage) }],
          },
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          result: {
            results: [{ xdr: pageXdr(nonAdvancingPage) }],
          },
        }),
      );
    const client = new StellarSorobanClient(
      TEST_CONFIG,
      { ...TEST_RPC_CONFIG, maxRetries: 0 },
      fetchImpl as unknown as typeof fetch,
      { sleep: vi.fn().mockResolvedValue(undefined), random: () => 0 },
    );

    await expect(client.fetchAllCreditRecords()).rejects.toThrow('Soroban enumeration cursor did not advance');
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('aborts slow RPC calls after the configured timeout', async () => {
    vi.useFakeTimers();
    const fetchImpl = vi.fn((_url: string, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })));
    }));
    const client = new StellarSorobanClient(
      TEST_CONFIG,
      { ...TEST_RPC_CONFIG, timeoutMs: 25, maxRetries: 0 },
      fetchImpl as unknown as typeof fetch,
      { sleep: vi.fn().mockResolvedValue(undefined), random: () => 0 },
    );

    try {
      const pending = client.fetchAllCreditRecords();
      const rejection = expect(pending).rejects.toThrow('Soroban RPC timed out after 25ms');
      await vi.advanceTimersByTimeAsync(25);
      await rejection;
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('parseEnumeratedCreditLinesScVal', () => {
  it('maps CreditLineData fields and computes availableCredit from utilized_amount', () => {
    expect(
      parseEnumeratedCreditLinesScVal(
        nativeToScVal([
          [
            7,
            {
              borrower: TEST_PUBLIC_KEY,
              credit_limit: '999999999999999999.0000001',
              utilized_amount: '0.0000001',
              interest_rate_bps: 700,
              status: { tag: 'Suspended' },
            },
          ],
        ]),
      ),
    ).toEqual([
      {
        id: '7',
        walletAddress: TEST_PUBLIC_KEY,
        creditLimit: '999999999999999999.0000001',
        availableCredit: '999999999999999999.0000000',
        interestRateBps: 700,
        status: 'suspended',
      },
    ]);
  });

  it('accepts tuple CreditLineData in contract field order', () => {
    expect(
      parseEnumeratedCreditLinesScVal(nativeToScVal([[1, [TEST_PUBLIC_KEY, 1000n, 250n, 300, 0]]])),
    ).toEqual([
      {
        id: '1',
        walletAddress: TEST_PUBLIC_KEY,
        creditLimit: '1000',
        availableCredit: '750',
        interestRateBps: 300,
        status: 'active',
      },
    ]);
  });

  it('rejects blank and malformed borrower public keys', () => {
    expect(() =>
      parseEnumeratedCreditLinesScVal(nativeToScVal([[1, ['', 1000n, 250n, 300, 0]]])),
    ).toThrow(SorobanCreditRecordDecodeError);

    expect(() =>
      parseEnumeratedCreditLinesScVal(nativeToScVal([[1, ['not-a-stellar-key', 1000n, 250n, 300, 0]]])),
    ).toThrow(SorobanCreditRecordDecodeError);

    expect(() =>
      parseEnumeratedCreditLinesScVal(nativeToScVal([[1, [TEST_PUBLIC_KEY.toLowerCase(), 1000n, 250n, 300, 0]]])),
    ).toThrow(SorobanCreditRecordDecodeError);
  });

  it('rejects malformed decimal values without accepting arbitrary stringable objects', () => {
    expect(() =>
      parseEnumeratedCreditLinesScVal(nativeToScVal([[1, [TEST_PUBLIC_KEY, '100.00.00', 250n, 300, 0]]])),
    ).toThrow(SorobanCreditRecordDecodeError);

    expect(() =>
      parseEnumeratedCreditLinesScVal(nativeToScVal([[1, [TEST_PUBLIC_KEY, 'abc', 250n, 300, 0]]])),
    ).toThrow(SorobanCreditRecordDecodeError);

    expect(() =>
      parseEnumeratedCreditLinesScVal(nativeToScVal([[1, [TEST_PUBLIC_KEY, '', 250n, 300, 0]]])),
    ).toThrow(SorobanCreditRecordDecodeError);

    expect(() =>
      parseEnumeratedCreditLinesScVal(
        nativeToScVal([[1, { borrower: TEST_PUBLIC_KEY, credit_limit: { value: '100' }, utilized_amount: 250n, interest_rate_bps: 300, status: 0 }]]),
      ),
    ).toThrow(SorobanCreditRecordDecodeError);
  });

  it('rejects unknown numeric status discriminants', () => {
    expect(() =>
      parseEnumeratedCreditLinesScVal(nativeToScVal([[1, [TEST_PUBLIC_KEY, 1000n, 250n, 300, 99]]])),
    ).toThrow(SorobanCreditRecordDecodeError);
  });

  it('rejects duplicate borrowers instead of letting reconciliation hide them', () => {
    let thrown: unknown;
    try {
      parseEnumeratedCreditLinesScVal(
        nativeToScVal([
          [0, [TEST_PUBLIC_KEY, 1000n, 0n, 300, 'Active']],
          [1, [TEST_PUBLIC_KEY, 2000n, 0n, 300, 'Active']],
        ]),
      );
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(SorobanCreditRecordDecodeError);
    expect((thrown as Error).message).toContain('[REDACTED_STELLAR_PUBLIC_KEY]');
    expect((thrown as Error).message).not.toContain(TEST_PUBLIC_KEY);
  });
});
