import { describe, it, expect, beforeEach, vi } from 'vitest';
import { StrKey } from '@stellar/stellar-sdk';
import { ReconciliationService, type OnChainCreditRecord, type SorobanRpcClient } from '../reconciliationService.js';
import type { CreditLineRepository } from '../../repositories/interfaces/CreditLineRepository.js';
import type { CreditLine } from '../../models/CreditLine.js';
import { CreditLineStatus } from '../../models/CreditLine.js';
import { InMemoryCreditLineRepository } from '../../repositories/memory/InMemoryCreditLineRepository.js';
import { InMemoryJobQueue } from '../jobQueue.js';
import { SorobanCreditRecordDecodeError, StellarSorobanClient } from '../sorobanClient.js';

const TEST_PUBLIC_KEY = `G${'A'.repeat(55)}`;
const TEST_SECRET_KEY = `S${'C'.repeat(55)}`;
const TEST_CONTRACT_ID = StrKey.encodeContract(Buffer.alloc(32, 1));

// Mock implementations
class MockCreditLineRepository implements Partial<CreditLineRepository> {
  private creditLines: CreditLine[] = [];

  setCreditLines(lines: CreditLine[]): void {
    this.creditLines = lines;
  }

  async findAll(offset = 0, limit = this.creditLines.length): Promise<CreditLine[]> {
    return this.creditLines.slice(offset, offset + limit);
  }
}

class MockSorobanClient implements SorobanRpcClient {
  private records: OnChainCreditRecord[] = [];

  setRecords(records: OnChainCreditRecord[]): void {
    this.records = records;
  }

  async fetchAllCreditRecords(): Promise<OnChainCreditRecord[]> {
    return this.records;
  }
}

function makeCreditLine(overrides: Partial<CreditLine> = {}): CreditLine {
  return {
    id: 'cl-1',
    walletAddress: 'GTEST123',
    creditLimit: '10000.00',
    availableCredit: '10000.00',
    utilized: '0',
    interestRateBps: 500,
    status: CreditLineStatus.ACTIVE,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200, statusText: 'OK' });
}

describe('ReconciliationService', () => {
  let service: ReconciliationService;
  let mockRepo: MockCreditLineRepository;
  let mockClient: MockSorobanClient;
  let jobQueue: InMemoryJobQueue;

  beforeEach(() => {
    mockRepo = new MockCreditLineRepository();
    mockClient = new MockSorobanClient();
    jobQueue = new InMemoryJobQueue(10, 20);
    
    service = new ReconciliationService(
      mockRepo as unknown as CreditLineRepository,
      mockClient,
      jobQueue
    );

    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  describe('reconcile()', () => {
    it('returns empty mismatches when DB and chain are in sync', async () => {
      const creditLine: CreditLine = {
        id: 'cl-1',
        walletAddress: 'GTEST123',
        creditLimit: '10000.00',
        availableCredit: '10000.00',
        utilized: '0',
        interestRateBps: 500,
        status: CreditLineStatus.ACTIVE,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const chainRecord: OnChainCreditRecord = {
        id: '7',
        walletAddress: 'GTEST123',
        creditLimit: '10000.00',
        availableCredit: '10000.00',
        interestRateBps: 500,
        status: 'active',
      };

      mockRepo.setCreditLines([creditLine]);
      mockClient.setRecords([chainRecord]);

      const result = await service.reconcile();

      expect(result.mismatches).toHaveLength(0);
      expect(result.totalChecked).toBe(1);
      expect(result.errors).toHaveLength(0);
    });

    it('matches records by borrower wallet instead of mismatching DB UUIDs with contract ids', async () => {
      const creditLine: CreditLine = {
        id: '7e5f5b84-e325-4a27-bf2a-241a2f12fd66',
        walletAddress: 'GTEST123',
        creditLimit: '10000.00',
        availableCredit: '7500.00',
        utilized: '2500.00',
        interestRateBps: 500,
        status: CreditLineStatus.ACTIVE,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const chainRecord: OnChainCreditRecord = {
        id: '0',
        walletAddress: 'GTEST123',
        creditLimit: '10000.00',
        availableCredit: '7500.00',
        interestRateBps: 500,
        status: 'active',
      };

      mockRepo.setCreditLines([creditLine]);
      mockClient.setRecords([chainRecord]);

      const result = await service.reconcile();

      expect(result.mismatches).toEqual([]);
      expect(result.errors).toEqual([]);
    });

    it('does not report amount drift for numerically equal decimal strings', async () => {
      mockRepo.setCreditLines([
        makeCreditLine({
          walletAddress: 'GTEST123',
          creditLimit: '10000.00',
          availableCredit: '7500.00000000',
          utilized: '2500.00',
        }),
      ]);
      mockClient.setRecords([
        {
          id: '0',
          walletAddress: 'GTEST123',
          creditLimit: '10000',
          availableCredit: '7500',
          interestRateBps: 500,
          status: 'active',
        },
      ]);

      const result = await service.reconcile();

      expect(result.mismatches).toEqual([]);
      expect(result.errors).toEqual([]);
    });

    it('detects credit limit mismatch', async () => {
      const creditLine: CreditLine = {
        id: 'cl-1',
        walletAddress: 'GTEST123',
        creditLimit: '10000.00',
        availableCredit: '10000.00',
        utilized: '0',
        interestRateBps: 500,
        status: CreditLineStatus.ACTIVE,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const chainRecord: OnChainCreditRecord = {
        id: 'cl-1',
        walletAddress: 'GTEST123',
        creditLimit: '15000.00', // Different
        availableCredit: '10000.00',
        interestRateBps: 500,
        status: 'active',
      };

      mockRepo.setCreditLines([creditLine]);
      mockClient.setRecords([chainRecord]);

      const result = await service.reconcile();

      expect(result.mismatches).toHaveLength(1);
      expect(result.mismatches[0]).toMatchObject({
        creditLineId: 'cl-1',
        field: 'creditLimit',
        dbValue: '10000.00',
        chainValue: '15000.00',
        severity: 'critical',
      });
    });

    it('treats different borrower wallets as existence drift', async () => {
      const creditLine: CreditLine = {
        id: 'cl-1',
        walletAddress: 'GTEST123',
        creditLimit: '10000.00',
        availableCredit: '10000.00',
        utilized: '0',
        interestRateBps: 500,
        status: CreditLineStatus.ACTIVE,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const chainRecord: OnChainCreditRecord = {
        id: 'cl-1',
        walletAddress: 'GTEST456', // Different
        creditLimit: '10000.00',
        availableCredit: '10000.00',
        interestRateBps: 500,
        status: 'active',
      };

      mockRepo.setCreditLines([creditLine]);
      mockClient.setRecords([chainRecord]);

      const result = await service.reconcile();

      expect(result.mismatches).toEqual([
        expect.objectContaining({
          creditLineId: 'cl-1',
          walletAddress: 'GTEST123',
          field: 'existence',
          dbValue: 'exists',
          chainValue: 'missing',
          severity: 'critical',
        }),
        expect.objectContaining({
          creditLineId: 'cl-1',
          walletAddress: 'GTEST456',
          field: 'existence',
          dbValue: 'missing',
          chainValue: 'exists',
          severity: 'critical',
        }),
      ]);
    });

    it('reports duplicate database borrower wallets instead of overwriting rows', async () => {
      const duplicateLines: CreditLine[] = [
        makeCreditLine({ id: 'cl-1', walletAddress: 'GTEST123' }),
        makeCreditLine({
          id: 'cl-2',
          walletAddress: 'GTEST123',
          creditLimit: '5000.00',
          availableCredit: '5000.00',
          interestRateBps: 300,
        }),
      ];

      mockRepo.setCreditLines(duplicateLines);
      mockClient.setRecords([]);

      const result = await service.reconcile();

      expect(result.totalChecked).toBe(2);
      expect(result.errors).toEqual(['Duplicate database credit lines for borrower wallet GTEST123']);
      expect(result.mismatches).toEqual([]);
    });

    it('redacts real-looking duplicate database borrower wallet errors before returning them', async () => {
      mockRepo.setCreditLines([
        makeCreditLine({ id: 'cl-1', walletAddress: TEST_PUBLIC_KEY }),
        makeCreditLine({ id: 'cl-2', walletAddress: TEST_PUBLIC_KEY }),
      ]);
      mockClient.setRecords([]);

      const result = await service.reconcile();

      expect(result.errors).toEqual([
        'Duplicate database credit lines for borrower wallet [REDACTED_STELLAR_PUBLIC_KEY]',
      ]);
      expect(JSON.stringify(result.errors)).not.toContain(TEST_PUBLIC_KEY);
    });

    it('reports duplicate on-chain borrower wallets instead of overwriting records', async () => {
      mockRepo.setCreditLines([]);
      mockClient.setRecords([
        {
          id: '0',
          walletAddress: 'GTEST123',
          creditLimit: '10000.00',
          availableCredit: '10000.00',
          interestRateBps: 500,
          status: 'active',
        },
        {
          id: '1',
          walletAddress: 'GTEST123',
          creditLimit: '5000.00',
          availableCredit: '5000.00',
          interestRateBps: 300,
          status: 'active',
        },
      ]);

      const result = await service.reconcile();

      expect(result.totalChecked).toBe(2);
      expect(result.errors).toEqual(['Duplicate on-chain credit records for borrower wallet GTEST123']);
      expect(result.mismatches).toEqual([]);
    });

    it('redacts real-looking duplicate on-chain borrower wallet errors before returning them', async () => {
      mockRepo.setCreditLines([]);
      mockClient.setRecords([
        {
          id: '0',
          walletAddress: TEST_PUBLIC_KEY,
          creditLimit: '10000.00',
          availableCredit: '10000.00',
          interestRateBps: 500,
          status: 'active',
        },
        {
          id: '1',
          walletAddress: TEST_PUBLIC_KEY,
          creditLimit: '5000.00',
          availableCredit: '5000.00',
          interestRateBps: 300,
          status: 'active',
        },
      ]);

      const result = await service.reconcile();

      expect(result.errors).toEqual([
        'Duplicate on-chain credit records for borrower wallet [REDACTED_STELLAR_PUBLIC_KEY]',
      ]);
      expect(JSON.stringify(result.errors)).not.toContain(TEST_PUBLIC_KEY);
    });

    it('matches borrower wallets after trimming without existence drift', async () => {
      mockRepo.setCreditLines([makeCreditLine({ walletAddress: ` ${TEST_PUBLIC_KEY} ` })]);
      mockClient.setRecords([
        {
          id: '0',
          walletAddress: TEST_PUBLIC_KEY,
          creditLimit: '10000.00',
          availableCredit: '10000.00',
          interestRateBps: 500,
          status: 'active',
        },
      ]);

      const result = await service.reconcile();

      expect(result.errors).toEqual([]);
      expect(result.mismatches).toEqual([
        expect.objectContaining({
          field: 'walletAddressFormatting',
          severity: 'warning',
          dbValue: ' [REDACTED_STELLAR_PUBLIC_KEY] ',
          chainValue: '[REDACTED_STELLAR_PUBLIC_KEY]',
        }),
      ]);
    });

    it('treats wallet keys that differ only by whitespace as duplicates', async () => {
      mockRepo.setCreditLines([
        makeCreditLine({ id: 'cl-1', walletAddress: ` ${TEST_PUBLIC_KEY}` }),
        makeCreditLine({ id: 'cl-2', walletAddress: `${TEST_PUBLIC_KEY} ` }),
      ]);
      mockClient.setRecords([]);

      const result = await service.reconcile();

      expect(result.errors).toEqual([
        'Duplicate database credit lines for borrower wallet [REDACTED_STELLAR_PUBLIC_KEY]',
      ]);
      expect(result.mismatches).toEqual([]);
    });

    it('captures blank database borrower wallets as reconciliation errors', async () => {
      mockRepo.setCreditLines([makeCreditLine({ walletAddress: '   ' })]);
      mockClient.setRecords([]);

      const result = await service.reconcile();

      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]).toContain('Borrower wallet address cannot be empty');
      expect(result.mismatches).toEqual([]);
    });

    it('captures blank on-chain borrower wallets as reconciliation errors', async () => {
      mockRepo.setCreditLines([]);
      mockClient.setRecords([
        {
          id: '0',
          walletAddress: '   ',
          creditLimit: '10000.00',
          availableCredit: '10000.00',
          interestRateBps: 500,
          status: 'active',
        },
      ]);

      const result = await service.reconcile();

      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]).toContain('Borrower wallet address cannot be empty');
      expect(result.mismatches).toEqual([]);
    });

    it('detects available credit mismatch with warning severity', async () => {
      const creditLine: CreditLine = {
        id: 'cl-1',
        walletAddress: 'GTEST123',
        creditLimit: '10000.00',
        availableCredit: '8000.00',
        utilized: '2000.00',
        interestRateBps: 500,
        status: CreditLineStatus.ACTIVE,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const chainRecord: OnChainCreditRecord = {
        id: 'cl-1',
        walletAddress: 'GTEST123',
        creditLimit: '10000.00',
        availableCredit: '9000.00', // Different
        interestRateBps: 500,
        status: 'active',
      };

      mockRepo.setCreditLines([creditLine]);
      mockClient.setRecords([chainRecord]);

      const result = await service.reconcile();

      expect(result.mismatches).toHaveLength(1);
      expect(result.mismatches[0]?.severity).toBe('warning');
      expect(result.mismatches[0]?.field).toBe('availableCredit');
    });

    it('detects interest rate mismatch', async () => {
      const creditLine: CreditLine = {
        id: 'cl-1',
        walletAddress: 'GTEST123',
        creditLimit: '10000.00',
        availableCredit: '10000.00',
        utilized: '0',
        interestRateBps: 500,
        status: CreditLineStatus.ACTIVE,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const chainRecord: OnChainCreditRecord = {
        id: 'cl-1',
        walletAddress: 'GTEST123',
        creditLimit: '10000.00',
        availableCredit: '10000.00',
        interestRateBps: 600, // Different
        status: 'active',
      };

      mockRepo.setCreditLines([creditLine]);
      mockClient.setRecords([chainRecord]);

      const result = await service.reconcile();

      expect(result.mismatches).toHaveLength(1);
      expect(result.mismatches[0]?.field).toBe('interestRateBps');
      expect(result.mismatches[0]?.severity).toBe('warning');
    });

    it('detects status mismatch', async () => {
      const creditLine: CreditLine = {
        id: 'cl-1',
        walletAddress: 'GTEST123',
        creditLimit: '10000.00',
        availableCredit: '10000.00',
        utilized: '0',
        interestRateBps: 500,
        status: CreditLineStatus.ACTIVE,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const chainRecord: OnChainCreditRecord = {
        id: 'cl-1',
        walletAddress: 'GTEST123',
        creditLimit: '10000.00',
        availableCredit: '10000.00',
        interestRateBps: 500,
        status: 'suspended', // Different
      };

      mockRepo.setCreditLines([creditLine]);
      mockClient.setRecords([chainRecord]);

      const result = await service.reconcile();

      expect(result.mismatches).toHaveLength(1);
      expect(result.mismatches[0]?.field).toBe('status');
      expect(result.mismatches[0]?.severity).toBe('critical');
    });

    it('detects record in DB but missing on chain', async () => {
      const creditLine: CreditLine = {
        id: 'cl-1',
        walletAddress: 'GTEST123',
        creditLimit: '10000.00',
        availableCredit: '10000.00',
        utilized: '0',
        interestRateBps: 500,
        status: CreditLineStatus.ACTIVE,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      mockRepo.setCreditLines([creditLine]);
      mockClient.setRecords([]); // Empty chain

      const result = await service.reconcile();

      expect(result.mismatches).toHaveLength(1);
      expect(result.mismatches[0]).toMatchObject({
        creditLineId: 'cl-1',
        field: 'existence',
        dbValue: 'exists',
        chainValue: 'missing',
        severity: 'critical',
      });
    });

    it('detects record on chain but missing in DB', async () => {
      const chainRecord: OnChainCreditRecord = {
        id: 'cl-2',
        walletAddress: 'GTEST456',
        creditLimit: '5000.00',
        availableCredit: '5000.00',
        interestRateBps: 300,
        status: 'active',
      };

      mockRepo.setCreditLines([]); // Empty DB
      mockClient.setRecords([chainRecord]);

      const result = await service.reconcile();

      expect(result.mismatches).toHaveLength(1);
      expect(result.mismatches[0]).toMatchObject({
        creditLineId: 'cl-2',
        field: 'existence',
        dbValue: 'missing',
        chainValue: 'exists',
        severity: 'critical',
      });
    });

    it('detects multiple mismatches across different fields', async () => {
      const creditLine: CreditLine = {
        id: 'cl-1',
        walletAddress: 'GTEST123',
        creditLimit: '10000.00',
        availableCredit: '8000.00',
        utilized: '2000.00',
        interestRateBps: 500,
        status: CreditLineStatus.ACTIVE,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const chainRecord: OnChainCreditRecord = {
        id: 'cl-1',
        walletAddress: 'GTEST123',
        creditLimit: '15000.00', // Different
        availableCredit: '9000.00', // Different
        interestRateBps: 600, // Different
        status: 'active',
      };

      mockRepo.setCreditLines([creditLine]);
      mockClient.setRecords([chainRecord]);

      const result = await service.reconcile();

      expect(result.mismatches).toHaveLength(3);
      expect(result.mismatches.map(m => m.field)).toContain('creditLimit');
      expect(result.mismatches.map(m => m.field)).toContain('availableCredit');
      expect(result.mismatches.map(m => m.field)).toContain('interestRateBps');
    });

    it('handles multiple credit lines correctly', async () => {
      const creditLines: CreditLine[] = [
        {
          id: 'cl-1',
          walletAddress: 'GTEST123',
          creditLimit: '10000.00',
          availableCredit: '10000.00',
          utilized: '0',
          interestRateBps: 500,
          status: CreditLineStatus.ACTIVE,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
        {
          id: 'cl-2',
          walletAddress: 'GTEST456',
          creditLimit: '5000.00',
          availableCredit: '5000.00',
          utilized: '0',
          interestRateBps: 300,
          status: CreditLineStatus.ACTIVE,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ];

      const chainRecords: OnChainCreditRecord[] = [
        {
          id: 'cl-1',
          walletAddress: 'GTEST123',
          creditLimit: '10000.00',
          availableCredit: '10000.00',
          interestRateBps: 500,
          status: 'active',
        },
        {
          id: 'cl-2',
          walletAddress: 'GTEST456',
          creditLimit: '5000.00',
          availableCredit: '5000.00',
          interestRateBps: 300,
          status: 'active',
        },
      ];

      mockRepo.setCreditLines(creditLines);
      mockClient.setRecords(chainRecords);

      const result = await service.reconcile();

      expect(result.mismatches).toHaveLength(0);
      expect(result.totalChecked).toBe(2);
    });

    it('captures errors during reconciliation', async () => {
      const errorClient = {
        async fetchAllCreditRecords(): Promise<OnChainCreditRecord[]> {
          throw new Error('RPC connection failed');
        },
      };

      const errorService = new ReconciliationService(
        mockRepo as unknown as CreditLineRepository,
        errorClient,
        jobQueue
      );

      const result = await errorService.reconcile();

      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]).toContain('RPC connection failed');
      expect(result.mismatches).toHaveLength(0);
    });

    it('captures typed decode failures with Stellar keys redacted', async () => {
      const errorClient = {
        async fetchAllCreditRecords(): Promise<OnChainCreditRecord[]> {
          throw new SorobanCreditRecordDecodeError(`bad XDR for ${TEST_PUBLIC_KEY} and ${TEST_SECRET_KEY}`);
        },
      };

      const errorService = new ReconciliationService(
        mockRepo as unknown as CreditLineRepository,
        errorClient,
        jobQueue
      );

      const result = await errorService.reconcile();

      expect(result.errors).toEqual([
        expect.stringContaining(
          'SorobanCreditRecordDecodeError: bad XDR for [REDACTED_STELLAR_PUBLIC_KEY] and [REDACTED_STELLAR_SECRET_KEY]',
        ),
      ]);
      expect(result.errors[0]).not.toContain(TEST_PUBLIC_KEY);
      expect(result.errors[0]).not.toContain(TEST_SECRET_KEY);
      expect(result.mismatches).toHaveLength(0);
    });

    it('captures malformed XDR from the real Soroban client as a reconciliation error', async () => {
      const fetchImpl = vi.fn().mockResolvedValue(
        jsonResponse({
          result: {
            results: [{ xdr: 'not-valid-base64-xdr' }],
          },
        }),
      );
      const realSorobanClient = new StellarSorobanClient(
        {
          rpcUrl: 'https://soroban-testnet.stellar.org',
          contractId: TEST_CONTRACT_ID,
          networkPassphrase: 'Test SDF Network ; September 2015',
        },
        {
          rpcUrl: 'https://soroban-testnet.stellar.org',
          networkPassphrase: 'Test SDF Network ; September 2015',
          timeoutMs: 50,
          maxRetries: 0,
          retryJitterMs: 0,
        },
        fetchImpl as unknown as typeof fetch,
        { sleep: vi.fn().mockResolvedValue(undefined), random: () => 0 },
      );
      const realClientService = new ReconciliationService(
        mockRepo as unknown as CreditLineRepository,
        realSorobanClient,
        jobQueue,
      );

      const result = await realClientService.reconcile();

      expect(result.errors).toEqual([
        expect.stringContaining('SorobanCreditRecordDecodeError: Could not decode enumerate_credit_lines ScVal'),
      ]);
      expect(result.mismatches).toEqual([]);
    });

    it('fetches database credit lines across multiple pages', async () => {
      mockRepo.setCreditLines(
        Array.from({ length: 1001 }, (_value, index) =>
          makeCreditLine({ id: `cl-${index}`, walletAddress: `wallet-${index}` }),
        ),
      );
      mockClient.setRecords([]);

      const result = await service.reconcile();

      expect(result.totalChecked).toBe(1001);
      expect(result.errors).toEqual([]);
      expect(result.mismatches).toHaveLength(1001);
    });

    it('fails loudly when database reconciliation exceeds the configured cap', async () => {
      mockRepo.setCreditLines(
        Array.from({ length: 10001 }, (_value, index) =>
          makeCreditLine({ id: `cl-${index}`, walletAddress: `wallet-${index}` }),
        ),
      );
      mockClient.setRecords([]);

      const result = await service.reconcile();

      expect(result.errors).toEqual([
        expect.stringContaining('Reconciliation exceeded 10000 database credit lines'),
      ]);
      expect(result.mismatches).toEqual([]);
    });

    it('flags DB-only and chain-only records as critical existence mismatches using the in-memory repository', async () => {
      const directRepo = new InMemoryCreditLineRepository();
      const dbLine = await directRepo.create({
        walletAddress: 'GDBONLY123',
        creditLimit: '1000.00',
        interestRateBps: 250,
      });
      const chainOnlyRecord: OnChainCreditRecord = {
        id: 'cl-chain-only',
        walletAddress: 'GCHAINONLY456',
        creditLimit: '2000.00',
        availableCredit: '2000.00',
        interestRateBps: 300,
        status: 'active',
      };

      const chainClient = {
        fetchAllCreditRecords: vi.fn().mockResolvedValue([chainOnlyRecord]),
      } as unknown as SorobanRpcClient;

      const directService = new ReconciliationService(
        directRepo,
        chainClient,
        jobQueue,
      );

      const result = await directService.reconcile();

      expect(result.errors).toHaveLength(0);
      expect(result.mismatches).toEqual(expect.arrayContaining([
        expect.objectContaining({
          creditLineId: dbLine.id,
          field: 'existence',
          dbValue: 'exists',
          chainValue: 'missing',
          severity: 'critical',
        }),
        expect.objectContaining({
          creditLineId: chainOnlyRecord.id,
          field: 'existence',
          dbValue: 'missing',
          chainValue: 'exists',
          severity: 'critical',
        }),
      ]));
    });

    it('classifies each comparable non-wallet field with the expected severity', async () => {
      const directRepo = new InMemoryCreditLineRepository();
      const dbLine = await directRepo.create({
        walletAddress: 'GTEST123',
        creditLimit: '10000.00',
        interestRateBps: 500,
      });
      const chainRecord: OnChainCreditRecord = {
        id: dbLine.id,
        walletAddress: dbLine.walletAddress,
        creditLimit: '15000.00',
        availableCredit: '9000.00',
        interestRateBps: 600,
        status: 'suspended',
      };

      const fieldClient = {
        fetchAllCreditRecords: vi.fn().mockResolvedValue([chainRecord]),
      } as unknown as SorobanRpcClient;

      const directService = new ReconciliationService(
        directRepo,
        fieldClient,
        jobQueue,
      );

      const result = await directService.reconcile();
      const mismatchesByField = new Map(result.mismatches.map((mismatch) => [mismatch.field, mismatch]));

      expect(result.errors).toHaveLength(0);
      expect(mismatchesByField.has('walletAddress')).toBe(false);
      expect(mismatchesByField.get('creditLimit')).toMatchObject({ severity: 'critical' });
      expect(mismatchesByField.get('availableCredit')).toMatchObject({ severity: 'warning' });
      expect(mismatchesByField.get('interestRateBps')).toMatchObject({ severity: 'warning' });
      expect(mismatchesByField.get('status')).toMatchObject({ severity: 'critical' });
    });

    it('captures client failures in errors without throwing when using the in-memory repository', async () => {
      const directRepo = new InMemoryCreditLineRepository();
      const failingClient = {
        fetchAllCreditRecords: vi.fn().mockRejectedValue(new Error('RPC connection failed')),
      } as unknown as SorobanRpcClient;

      const directService = new ReconciliationService(
        directRepo,
        failingClient,
        jobQueue,
      );

      await expect(directService.reconcile()).resolves.toMatchObject({
        errors: [expect.stringContaining('RPC connection failed')],
        mismatches: [],
      });
    });

    it('sets timestamp on result', async () => {
      mockRepo.setCreditLines([]);
      mockClient.setRecords([]);

      const before = Date.now();
      const result = await service.reconcile();
      const after = Date.now();

      expect(result.timestamp.getTime()).toBeGreaterThanOrEqual(before);
      expect(result.timestamp.getTime()).toBeLessThanOrEqual(after);
    });

    it('logs error when mismatches are found', async () => {
      const creditLine: CreditLine = {
        id: 'cl-1',
        walletAddress: 'GTEST123',
        creditLimit: '10000.00',
        availableCredit: '10000.00',
        utilized: '0',
        interestRateBps: 500,
        status: CreditLineStatus.ACTIVE,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      mockRepo.setCreditLines([creditLine]);
      mockClient.setRecords([]); // Missing on chain

      await service.reconcile();

      expect(console.error).toHaveBeenCalledWith(
        expect.stringContaining('Found 1 mismatches'),
        expect.any(String)
      );
    });

    it('logs success when no mismatches found', async () => {
      mockRepo.setCreditLines([]);
      mockClient.setRecords([]);

      await service.reconcile();

      expect(console.log).toHaveBeenCalledWith(
        expect.stringContaining('no mismatches found')
      );
    });
  });

  describe('scheduleReconciliation()', () => {
    it('enqueues a job and returns job id', () => {
      const jobId = service.scheduleReconciliation();
      
      expect(jobId).toBeDefined();
      expect(typeof jobId).toBe('string');
      expect(jobQueue.size()).toBe(1);
    });

    it('supports delayed execution', () => {
      const jobId = service.scheduleReconciliation(5000);
      
      expect(jobId).toBeDefined();
      expect(jobQueue.size()).toBe(1);
    });

    it('can schedule multiple jobs', () => {
      service.scheduleReconciliation();
      service.scheduleReconciliation();
      
      expect(jobQueue.size()).toBe(2);
    });
  });
});
