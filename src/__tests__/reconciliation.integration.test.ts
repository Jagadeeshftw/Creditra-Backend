import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { StrKey, nativeToScVal } from '@stellar/stellar-sdk';
import { ReconciliationService, type OnChainCreditRecord, type SorobanRpcClient } from '../services/reconciliationService.js';
import { ReconciliationWorker } from '../services/reconciliationWorker.js';
import { InMemoryCreditLineRepository } from '../repositories/memory/InMemoryCreditLineRepository.js';
import { InMemoryJobQueue } from '../services/jobQueue.js';
import { StellarSorobanClient } from '../services/sorobanClient.js';

const TEST_PUBLIC_KEY = StrKey.encodeEd25519PublicKey(Buffer.alloc(32, 1));
const TEST_CONTRACT_ID = StrKey.encodeContract(Buffer.alloc(32, 1));

function pageXdr(value: unknown): string {
  return nativeToScVal(value).toXDR('base64');
}

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200, statusText: 'OK' });
}

class TestSorobanClient implements SorobanRpcClient {
  private records: OnChainCreditRecord[] = [];

  setRecords(records: OnChainCreditRecord[]): void {
    this.records = records;
  }

  async fetchAllCreditRecords(): Promise<OnChainCreditRecord[]> {
    return this.records;
  }
}

describe('Reconciliation Integration', () => {
  let repository: InMemoryCreditLineRepository;
  let sorobanClient: TestSorobanClient;
  let jobQueue: InMemoryJobQueue;
  let service: ReconciliationService;
  let worker: ReconciliationWorker;

  beforeEach(() => {
    vi.useFakeTimers();
    repository = new InMemoryCreditLineRepository();
    sorobanClient = new TestSorobanClient();
    jobQueue = new InMemoryJobQueue(10, 20);
    
    service = new ReconciliationService(repository, sorobanClient, jobQueue);
    worker = new ReconciliationWorker(service, jobQueue);

    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    if (worker.isRunning()) {
      worker.stop();
    }
    vi.useRealTimers();
  });

  it('end-to-end: detects and alerts on critical mismatch', async () => {
    // Setup: Create credit line in DB
    await repository.create({
      walletAddress: 'GTEST123',
      creditLimit: '10000.00',
      interestRateBps: 500,
    });

    // Setup: No matching record on chain
    sorobanClient.setRecords([]);

    // Start worker
    worker.start({ runImmediately: true });
    
    // Process the job with retries
    await jobQueue.drain();
    await vi.advanceTimersByTimeAsync(500);
    await jobQueue.drain();
    await vi.advanceTimersByTimeAsync(500);
    await jobQueue.drain();

    // Verify: Job failed due to critical mismatch
    expect(jobQueue.getFailedJobs()).toHaveLength(1);
    expect(console.error).toHaveBeenCalledWith(
      '[ReconciliationWorker] ALERT: Reconciliation found 1 mismatches (1 critical, 0 warnings)'
    );
  });

  it('end-to-end: succeeds when records are in sync', async () => {
    // Setup: Create matching records
    const creditLine = await repository.create({
      walletAddress: 'GTEST123',
      creditLimit: '10000.00',
      interestRateBps: 500,
    });

    sorobanClient.setRecords([{
      id: creditLine.id,
      walletAddress: 'GTEST123',
      creditLimit: '10000.00',
      availableCredit: '10000.00',
      interestRateBps: 500,
      status: 'active',
    }]);

    // Start worker
    worker.start({ runImmediately: true });
    
    // Process the job
    await jobQueue.drain();

    // Verify: Job succeeded
    expect(jobQueue.getFailedJobs()).toHaveLength(0);
    expect(console.log).toHaveBeenCalledWith(
      expect.stringContaining('completed successfully')
    );
  });

  it('end-to-end: real Soroban client output flows through reconciliation', async () => {
    const creditLine = await repository.create({
      walletAddress: TEST_PUBLIC_KEY,
      creditLimit: '10000.00',
      interestRateBps: 500,
    });
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
                    credit_limit: 10000n,
                    utilized_amount: 0n,
                    interest_rate_bps: creditLine.interestRateBps,
                    status: 'active',
                  },
                ],
              ]),
            },
          ],
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
    const realService = new ReconciliationService(repository, realSorobanClient, jobQueue);

    const result = await realService.reconcile();

    expect(result.mismatches).toEqual([]);
    expect(result.errors).toEqual([]);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('end-to-end: handles warning-level mismatches without failing', async () => {
    // Setup: Create credit line with different available credit
    const creditLine = await repository.create({
      walletAddress: 'GTEST123',
      creditLimit: '10000.00',
      interestRateBps: 500,
    });

    sorobanClient.setRecords([{
      id: creditLine.id,
      walletAddress: 'GTEST123',
      creditLimit: '10000.00',
      availableCredit: '9000.00', // Different available credit
      interestRateBps: 500,
      status: 'active',
    }]);

    // Start worker
    worker.start({ runImmediately: true });
    
    // Process the job
    await jobQueue.drain();

    // Verify: Job succeeded despite warning
    expect(jobQueue.getFailedJobs()).toHaveLength(0);
    expect(console.error).toHaveBeenCalledWith(
      '[ReconciliationWorker] ALERT: Reconciliation found 1 mismatches (0 critical, 1 warnings)'
    );
  });

  it('end-to-end: retries on transient failures', async () => {
    let callCount = 0;
    const failingClient: SorobanRpcClient = {
      async fetchAllCreditRecords(): Promise<OnChainCreditRecord[]> {
        callCount++;
        if (callCount < 3) {
          throw new Error('Transient RPC error');
        }
        return [];
      },
    };

    const failingService = new ReconciliationService(
      repository,
      failingClient,
      jobQueue
    );
    const failingWorker = new ReconciliationWorker(failingService, jobQueue);

    await repository.create({
      walletAddress: 'GTEST123',
      creditLimit: '10000.00',
      interestRateBps: 500,
    });

    failingWorker.start({ runImmediately: true });
    
    // Process with retries
    await jobQueue.drain();
    await vi.advanceTimersByTimeAsync(500);
    await jobQueue.drain();
    await vi.advanceTimersByTimeAsync(500);
    await jobQueue.drain();

    // Verify: Job eventually succeeded after retries
    expect(callCount).toBe(3);
    expect(jobQueue.getFailedJobs()).toHaveLength(1); // Still fails due to missing chain record
  });

  it('end-to-end: periodic scheduling works', async () => {
    sorobanClient.setRecords([]);
    await repository.create({
      walletAddress: 'GTEST123',
      creditLimit: '10000.00',
      interestRateBps: 500,
    });

    // Start with 1 second interval
    worker.start({ intervalMs: 1000, runImmediately: false });

    // No jobs initially
    expect(jobQueue.size()).toBe(0);

    // Advance time by 1 second
    await vi.advanceTimersByTimeAsync(1000);
    expect(jobQueue.size()).toBe(1);

    // Process first job
    await jobQueue.drain();

    // Advance another second
    await vi.advanceTimersByTimeAsync(1000);
    expect(jobQueue.size()).toBe(1);
  });

  it('end-to-end: detects multiple types of mismatches', async () => {
    const creditLine = await repository.create({
      walletAddress: 'GTEST123',
      creditLimit: '10000.00',
      interestRateBps: 500,
    });

    // Chain has different limit, available credit, and interest rate
    sorobanClient.setRecords([{
      id: creditLine.id,
      walletAddress: 'GTEST123',
      creditLimit: '15000.00', // Critical
      availableCredit: '9000.00', // Warning
      interestRateBps: 600, // Warning
      status: 'active',
    }]);

    const result = await service.reconcile();

    expect(result.mismatches).toHaveLength(3);
    expect(result.mismatches.filter(m => m.severity === 'critical')).toHaveLength(1);
    expect(result.mismatches.filter(m => m.severity === 'warning')).toHaveLength(2);
  });
});
