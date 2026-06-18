import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ReconciliationService, type OnChainCreditRecord, type SorobanRpcClient } from '../reconciliationService.js';
import type { CreditLineRepository } from '../../repositories/interfaces/CreditLineRepository.js';
import type { CreditLine } from '../../models/CreditLine.js';
import { CreditLineStatus } from '../../models/CreditLine.js';
import { InMemoryJobQueue } from '../jobQueue.js';

const TEST_PUBLIC_KEY = `G${'A'.repeat(55)}`;

// Mock implementations
class MockCreditLineRepository implements Partial<CreditLineRepository> {
  private creditLines: CreditLine[] = [];

  setCreditLines(lines: CreditLine[]): void {
    this.creditLines = lines;
  }

  async findAll(): Promise<CreditLine[]> {
    return this.creditLines;
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
        {
          id: 'cl-1',
          walletAddress: 'GTEST123',
          creditLimit: '10000.00',
          availableCredit: '10000.00',
          interestRateBps: 500,
          status: CreditLineStatus.ACTIVE,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
        {
          id: 'cl-2',
          walletAddress: 'GTEST123',
          creditLimit: '5000.00',
          availableCredit: '5000.00',
          interestRateBps: 300,
          status: CreditLineStatus.ACTIVE,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ];

      mockRepo.setCreditLines(duplicateLines);
      mockClient.setRecords([]);

      const result = await service.reconcile();

      expect(result.totalChecked).toBe(2);
      expect(result.errors).toEqual(['Duplicate database credit lines for borrower wallet GTEST123']);
      expect(result.mismatches).toEqual([]);
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

    it('captures reconciliation failures with Stellar keys redacted', async () => {
      const errorClient = {
        async fetchAllCreditRecords(): Promise<OnChainCreditRecord[]> {
          throw new Error(`RPC connection failed for ${TEST_PUBLIC_KEY}`);
        },
      };

      const errorService = new ReconciliationService(
        mockRepo as CreditLineRepository,
        errorClient,
        jobQueue
      );

      const result = await errorService.reconcile();

      expect(result.errors).toEqual([
        expect.stringContaining('Error: RPC connection failed for [REDACTED_STELLAR_PUBLIC_KEY]'),
      ]);
      expect(result.errors[0]).not.toContain(TEST_PUBLIC_KEY);
      expect(result.mismatches).toHaveLength(0);
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
