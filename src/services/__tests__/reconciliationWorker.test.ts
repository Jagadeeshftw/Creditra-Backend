import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { ReconciliationWorker } from '../reconciliationWorker.js';
import { ReconciliationService, type SorobanRpcClient, type OnChainCreditRecord } from '../reconciliationService.js';
import type { CreditLineRepository } from '../../repositories/interfaces/CreditLineRepository.js';
import type { CreditLine } from '../../models/CreditLine.js';
import { CreditLineStatus } from '../../models/CreditLine.js';
import { InMemoryJobQueue } from '../jobQueue.js';

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

describe('ReconciliationWorker', () => {
  let worker: ReconciliationWorker;
  let service: ReconciliationService;
  let mockRepo: MockCreditLineRepository;
  let mockClient: MockSorobanClient;
  let jobQueue: InMemoryJobQueue;

  beforeEach(() => {
    vi.useFakeTimers();
    mockRepo = new MockCreditLineRepository();
    mockClient = new MockSorobanClient();
    jobQueue = new InMemoryJobQueue(10, 20);
    
    service = new ReconciliationService(
      mockRepo as unknown as CreditLineRepository,
      mockClient,
      jobQueue
    );

    worker = new ReconciliationWorker(service, jobQueue);

    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    if (worker.isRunning()) {
      worker.stop();
    }
    vi.useRealTimers();
  });

  describe('start()', () => {
    it('starts the worker and sets running state', () => {
      worker.start({ runImmediately: false });
      expect(worker.isRunning()).toBe(true);
    });

    it('schedules immediate reconciliation by default', async () => {
      mockRepo.setCreditLines([]);
      mockClient.setRecords([]);

      worker.start();
      
      expect(jobQueue.size()).toBe(1);
    });

    it('skips immediate reconciliation when runImmediately is false', () => {
      worker.start({ runImmediately: false });
      
      expect(jobQueue.size()).toBe(0);
    });

    it('schedules periodic reconciliation at specified interval', async () => {
      worker.start({ intervalMs: 1000, runImmediately: false });
      
      expect(jobQueue.size()).toBe(0);
      
      await vi.advanceTimersByTimeAsync(1000);
      expect(jobQueue.size()).toBe(1);
      
      // Process the first job before advancing again
      await jobQueue.drain();
      
      await vi.advanceTimersByTimeAsync(1000);
      expect(jobQueue.size()).toBe(1);
    });

    it('is idempotent when called multiple times', () => {
      worker.start({ runImmediately: false });
      worker.start({ runImmediately: false });
      
      expect(worker.isRunning()).toBe(true);
      expect(console.warn).toHaveBeenCalledWith(
        expect.stringContaining('Already running')
      );
    });

    it('starts the job queue', () => {
      worker.start({ runImmediately: false });
      expect(jobQueue.isRunning()).toBe(true);
    });
  });

  describe('stop()', () => {
    it('stops the worker and clears running state', () => {
      worker.start({ runImmediately: false });
      worker.stop();
      
      expect(worker.isRunning()).toBe(false);
    });

    it('stops scheduling new jobs', async () => {
      worker.start({ intervalMs: 1000, runImmediately: false });
      worker.stop();
      
      const sizeBefore = jobQueue.size();
      await vi.advanceTimersByTimeAsync(2000);
      
      expect(jobQueue.size()).toBe(sizeBefore);
    });

    it('is idempotent when called multiple times', () => {
      worker.stop();
      worker.stop();
      
      expect(console.warn).toHaveBeenCalledWith(
        expect.stringContaining('Not running')
      );
    });
  });

  describe('job handler', () => {
    it('processes reconciliation job successfully when no mismatches', async () => {
      mockRepo.setCreditLines([]);
      mockClient.setRecords([]);

      worker.start({ runImmediately: true });
      await jobQueue.drain();

      expect(console.log).toHaveBeenCalledWith(
        expect.stringContaining('completed successfully')
      );
      expect(jobQueue.getFailedJobs()).toHaveLength(0);
    });

    it('throws error and fails job on critical mismatches', async () => {
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
      mockClient.setRecords([]); // Missing on chain - critical

      worker.start({ runImmediately: true });
      
      // Process initial attempt
      await jobQueue.drain();
      
      // Advance time for retry backoff and process retries
      await vi.advanceTimersByTimeAsync(500);
      await jobQueue.drain();
      await vi.advanceTimersByTimeAsync(500);
      await jobQueue.drain();

      expect(console.error).toHaveBeenCalledWith(
        '[ReconciliationWorker] ALERT: Reconciliation found 1 mismatches (1 critical, 0 warnings)'
      );
      expect(jobQueue.getFailedJobs()).toHaveLength(1);
    });

    it('succeeds when only warning-level mismatches exist', async () => {
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
        availableCredit: '9000.00', // Warning-level mismatch
        interestRateBps: 500,
        status: 'active',
      };

      mockRepo.setCreditLines([creditLine]);
      mockClient.setRecords([chainRecord]);

      worker.start({ runImmediately: true });
      await jobQueue.drain();

      expect(console.error).toHaveBeenCalledWith(
        '[ReconciliationWorker] ALERT: Reconciliation found 1 mismatches (0 critical, 1 warnings)'
      );
      expect(jobQueue.getFailedJobs()).toHaveLength(0); // Should succeed
    });

    it('retries failed jobs according to maxAttempts', async () => {
      let attemptCount = 0;
      const errorClient = {
        async fetchAllCreditRecords(): Promise<OnChainCreditRecord[]> {
          attemptCount++;
          throw new Error('RPC timeout');
        },
      };

      const errorService = new ReconciliationService(
        mockRepo as unknown as CreditLineRepository,
        errorClient,
        jobQueue
      );

      const errorWorker = new ReconciliationWorker(errorService, jobQueue);
      errorWorker.start({ runImmediately: true });
      
      // Process all attempts with retry backoff
      await jobQueue.drain();
      await vi.advanceTimersByTimeAsync(500);
      await jobQueue.drain();
      await vi.advanceTimersByTimeAsync(500);
      await jobQueue.drain();

      expect(attemptCount).toBe(3);
      expect(jobQueue.getFailedJobs()).toHaveLength(1);
      expect(jobQueue.getFailedJobs()[0]?.attempts).toBe(3);
    });

    it('logs job attempt number', async () => {
      mockRepo.setCreditLines([]);
      mockClient.setRecords([]);

      worker.start({ runImmediately: true });
      await jobQueue.drain();

      expect(console.log).toHaveBeenCalledWith(
        expect.stringContaining('attempt 1')
      );
    });
  });

  describe('isRunning()', () => {
    it('returns false before start', () => {
      expect(worker.isRunning()).toBe(false);
    });

    it('returns true after start', () => {
      worker.start({ runImmediately: false });
      expect(worker.isRunning()).toBe(true);
    });

    it('returns false after stop', () => {
      worker.start({ runImmediately: false });
      worker.stop();
      expect(worker.isRunning()).toBe(false);
    });
  });
});
