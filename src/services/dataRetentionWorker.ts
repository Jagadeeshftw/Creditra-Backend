/**
 * Data Retention Worker
 *
 * Registers the data-retention job handler with the job queue and provides
 * utilities for starting a scheduled retention sweep. Mirrors the structure
 * of ReconciliationWorker. See docs/DATA_RETENTION.md for the policy.
 */
import type { JobQueue, Job } from './jobQueue.js';
import type { DataRetentionService, DataRetentionConfig } from './dataRetentionService.js';

export interface DataRetentionWorkerConfig {
  /** How often to run the retention sweep (in milliseconds). Default: 24 hours. */
  intervalMs?: number;
  /** Whether to run a sweep immediately on worker start. */
  runImmediately?: boolean;
  /** Retention windows to enforce on each run. */
  retentionConfig: DataRetentionConfig;
}

export class DataRetentionWorker {
  private intervalHandle: ReturnType<typeof setInterval> | null = null;
  private running = false;
  private retentionConfig: DataRetentionConfig | null = null;

  constructor(
    private dataRetentionService: DataRetentionService,
    private jobQueue: JobQueue,
  ) {
    this.jobQueue.registerHandler('data-retention-sweep', async (job: Job) => {
      const config = job.payload as DataRetentionConfig;
      console.log(`[DataRetentionWorker] Processing job ${job.id} (attempt ${job.attempts + 1})`);

      try {
        const result = await this.dataRetentionService.run(config);

        if (result.errors.length > 0) {
          console.error('[DataRetentionWorker] Retention sweep completed with errors:', result.errors);
          throw new Error(`Data retention errors: ${result.errors.join(', ')}`);
        }

        console.log(
          `[DataRetentionWorker] Job ${job.id} completed. ` +
          `Events deleted: ${result.eventsDeleted}, ` +
          `risk evaluations deleted: ${result.riskEvaluationsDeleted}, ` +
          `borrowers anonymized: ${result.borrowersAnonymized}.`,
        );
      } catch (error) {
        console.error(`[DataRetentionWorker] Job ${job.id} failed:`, error);
        throw error;
      }
    });
  }

  /** Schedule a retention sweep job to run asynchronously. */
  scheduleSweep(config: DataRetentionConfig, delayMs = 0): string {
    return this.jobQueue.enqueue('data-retention-sweep', config, { delayMs, maxAttempts: 3 });
  }

  /** Start the worker with scheduled periodic sweeps. */
  start(config: DataRetentionWorkerConfig): void {
    if (this.running) {
      console.warn('[DataRetentionWorker] Already running');
      return;
    }

    const intervalMs = config.intervalMs ?? 86400000; // Default: 24 hours
    const runImmediately = config.runImmediately ?? true;
    this.retentionConfig = config.retentionConfig;

    this.running = true;
    this.jobQueue.start();

    if (runImmediately) {
      console.log('[DataRetentionWorker] Scheduling immediate retention sweep');
      this.scheduleSweep(this.retentionConfig, 0);
    }

    this.intervalHandle = setInterval(() => {
      console.log('[DataRetentionWorker] Scheduling periodic retention sweep');
      this.scheduleSweep(this.retentionConfig as DataRetentionConfig, 0);
    }, intervalMs);

    console.log(
      `[DataRetentionWorker] Started. Running every ${intervalMs}ms ` +
      `(${Math.round(intervalMs / 3600000)} hours). ` +
      `Operational retention: ${config.retentionConfig.operationalRetentionDays}d, ` +
      `events retention: ${config.retentionConfig.eventsRetentionDays}d.`,
    );
  }

  /** Stop the worker. */
  stop(): void {
    if (!this.running) {
      console.warn('[DataRetentionWorker] Not running');
      return;
    }

    if (this.intervalHandle) {
      clearInterval(this.intervalHandle);
      this.intervalHandle = null;
    }

    this.running = false;
    console.log('[DataRetentionWorker] Stopped');
  }

  isRunning(): boolean {
    return this.running;
  }
}
