import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { DbClient } from '../db/client.js';
import {
  DataRetentionService,
  DEFAULT_OPERATIONAL_RETENTION_DAYS,
  DEFAULT_EVENTS_RETENTION_DAYS,
} from '../services/dataRetentionService.js';
import { DataRetentionWorker } from '../services/dataRetentionWorker.js';
import { InMemoryJobQueue } from '../services/jobQueue.js';

class FakeDbClient implements DbClient {
  public queries: { text: string; values?: unknown[] }[] = [];
  /** Queue of canned row results, consumed in call order. */
  private responses: unknown[][] = [];
  private failNext: Error | null = null;

  queueResponse(rows: unknown[]): void {
    this.responses.push(rows);
  }

  failNextQuery(error: Error): void {
    this.failNext = error;
  }

  async query(text: string, values?: unknown[]): Promise<{ rows: unknown[] }> {
    this.queries.push({ text, values });

    if (this.failNext) {
      const error = this.failNext;
      this.failNext = null;
      throw error;
    }

    return { rows: this.responses.shift() ?? [] };
  }

  async end(): Promise<void> {}
}

describe('DataRetentionService', () => {
  let client: FakeDbClient;
  let service: DataRetentionService;

  beforeEach(() => {
    client = new FakeDbClient();
    service = new DataRetentionService(client);
  });

  it('purgeExpiredEvents deletes events older than the retention window and returns the count', async () => {
    client.queueResponse([{ id: '1' }, { id: '2' }, { id: '3' }]);

    const count = await service.purgeExpiredEvents(365);

    expect(count).toBe(3);
    expect(client.queries[0].text).toContain('DELETE FROM events');
    expect(client.queries[0].values).toEqual([365]);
  });

  it('purgeStaleRiskEvaluations only targets borrowers without an active credit line', async () => {
    client.queueResponse([{ id: 'eval-1' }]);

    const count = await service.purgeStaleRiskEvaluations(90);

    expect(count).toBe(1);
    expect(client.queries[0].text).toContain('DELETE FROM risk_evaluations');
    expect(client.queries[0].text).toContain("status = 'active'");
    expect(client.queries[0].values).toEqual([90]);
  });

  it('anonymizeStaleBorrowers hashes wallet_address and sets anonymized_at, returning the count', async () => {
    client.queueResponse([{ id: 'borrower-1' }, { id: 'borrower-2' }]);

    const count = await service.anonymizeStaleBorrowers(90);

    expect(count).toBe(2);
    expect(client.queries[0].text).toContain('UPDATE borrowers');
    expect(client.queries[0].text).toContain('anonymized_at = now()');
    expect(client.queries[0].text).toContain('has_active_line IS NOT TRUE');
    expect(client.queries[0].values).toEqual([90]);
  });

  it('recordRun inserts a row into data_retention_runs with the run summary', async () => {
    client.queueResponse([]);

    await service.recordRun(
      { operationalRetentionDays: 90, eventsRetentionDays: 365 },
      { eventsDeleted: 5, riskEvaluationsDeleted: 2, borrowersAnonymized: 1, errors: [] },
    );

    expect(client.queries[0].text).toContain('INSERT INTO data_retention_runs');
    expect(client.queries[0].values).toEqual([5, 2, 1, 90, 365, null]);
  });

  it('recordRun serializes errors as JSON when present', async () => {
    client.queueResponse([]);

    await service.recordRun(
      { operationalRetentionDays: 90, eventsRetentionDays: 365 },
      { eventsDeleted: 0, riskEvaluationsDeleted: 0, borrowersAnonymized: 0, errors: ['boom'] },
    );

    expect(client.queries[0].values?.[5]).toBe(JSON.stringify(['boom']));
  });

  describe('run', () => {
    it('executes all steps in order, records the run, and returns aggregated counts', async () => {
      client.queueResponse([{ id: '1' }]); // events
      client.queueResponse([{ id: '2' }, { id: '3' }]); // risk evaluations
      client.queueResponse([{ id: '4' }]); // borrowers
      client.queueResponse([]); // recordRun insert

      const result = await service.run({
        operationalRetentionDays: DEFAULT_OPERATIONAL_RETENTION_DAYS,
        eventsRetentionDays: DEFAULT_EVENTS_RETENTION_DAYS,
      });

      expect(result.eventsDeleted).toBe(1);
      expect(result.riskEvaluationsDeleted).toBe(2);
      expect(result.borrowersAnonymized).toBe(1);
      expect(result.errors).toEqual([]);
      expect(client.queries).toHaveLength(4);
      expect(client.queries[3].text).toContain('INSERT INTO data_retention_runs');
    });

    it('collects errors per-step without aborting the remaining steps', async () => {
      client.failNextQuery(new Error('events table locked'));
      client.queueResponse([{ id: 'eval-1' }]); // risk evaluations succeeds
      client.queueResponse([]); // borrowers succeeds (no rows)
      client.queueResponse([]); // recordRun insert

      const result = await service.run({
        operationalRetentionDays: 90,
        eventsRetentionDays: 365,
      });

      expect(result.eventsDeleted).toBe(0);
      expect(result.riskEvaluationsDeleted).toBe(1);
      expect(result.errors).toEqual(['purgeExpiredEvents: events table locked']);
    });
  });

  describe('preview', () => {
    it('returns counts without issuing any DELETE/UPDATE statements', async () => {
      client.queueResponse([{ count: 7 }]);
      client.queueResponse([{ count: 3 }]);
      client.queueResponse([{ count: 2 }]);

      const result = await service.preview({
        operationalRetentionDays: 90,
        eventsRetentionDays: 365,
      });

      expect(result.eventsDeleted).toBe(7);
      expect(result.riskEvaluationsDeleted).toBe(3);
      expect(result.borrowersAnonymized).toBe(2);
      for (const q of client.queries) {
        expect(q.text).not.toMatch(/\bDELETE\b|\bUPDATE\b/i);
      }
    });
  });
});

describe('DataRetentionWorker', () => {
  let client: FakeDbClient;
  let service: DataRetentionService;
  let jobQueue: InMemoryJobQueue;
  let worker: DataRetentionWorker;

  beforeEach(() => {
    vi.useFakeTimers();
    client = new FakeDbClient();
    service = new DataRetentionService(client);
    jobQueue = new InMemoryJobQueue(10, 20);
    worker = new DataRetentionWorker(service, jobQueue);
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    if (worker.isRunning()) worker.stop();
    vi.useRealTimers();
  });

  it('runs a sweep immediately on start and reports success', async () => {
    client.queueResponse([]); // events
    client.queueResponse([]); // risk evaluations
    client.queueResponse([]); // borrowers
    client.queueResponse([]); // recordRun insert

    worker.start({
      runImmediately: true,
      retentionConfig: { operationalRetentionDays: 90, eventsRetentionDays: 365 },
    });

    await jobQueue.drain();

    expect(jobQueue.getFailedJobs()).toHaveLength(0);
    expect(client.queries.some((q) => q.text.includes('DELETE FROM events'))).toBe(true);
  });

  it('does not schedule an immediate sweep unless runImmediately is set', () => {
    worker.start({
      runImmediately: false,
      retentionConfig: { operationalRetentionDays: 90, eventsRetentionDays: 365 },
    });

    expect(jobQueue.size()).toBe(0);
  });

  it('is idempotent: calling start twice does not double-schedule', () => {
    worker.start({
      runImmediately: true,
      retentionConfig: { operationalRetentionDays: 90, eventsRetentionDays: 365 },
    });
    const sizeAfterFirstStart = jobQueue.size();

    worker.start({
      runImmediately: true,
      retentionConfig: { operationalRetentionDays: 90, eventsRetentionDays: 365 },
    });

    expect(jobQueue.size()).toBe(sizeAfterFirstStart);
  });
});
