/**
 * Reconciliation Worker
 * 
 * Registers the credit reconciliation job handler with the job queue
 * and provides utilities for starting scheduled reconciliation.
 */

import type { JobQueue, Job } from './jobQueue.js';
import type { ReconciliationService } from './reconciliationService.js';
import { sanitizeJsonForStellarDiagnostics, sanitizeStellarDiagnostic } from './stellarDiagnostics.js';

export interface ReconciliationWorkerConfig {
  /** How often to run reconciliation (in milliseconds). Default: 1 hour */
  intervalMs?: number;
  /** Whether to start reconciliation immediately on worker start */
  runImmediately?: boolean;
}

export class ReconciliationWorker {
  private intervalHandle: ReturnType<typeof setInterval> | null = null;
  private running = false;

  constructor(
    private reconciliationService: ReconciliationService,
    private jobQueue: JobQueue,
  ) {
    // Register the job handler
    this.jobQueue.registerHandler('credit-reconciliation', async (job: Job) => {
      console.log(`[ReconciliationWorker] Processing job ${job.id} (attempt ${job.attempts + 1})`);
      
      try {
        const result = await this.reconciliationService.reconcile();
        
        // Alert on persistent mismatches
        if (result.mismatches.length > 0) {
          const criticalCount = result.mismatches.filter(m => m.severity === 'critical').length;
          const warningCount = result.mismatches.filter(m => m.severity === 'warning').length;
          
          console.error(
            `[ReconciliationWorker] ALERT: Reconciliation found ${result.mismatches.length} mismatches ` +
            `(${criticalCount} critical, ${warningCount} warnings)`
          );
          
          // In production, send alerts via email, Slack, PagerDuty, etc.
          // For now, log to console and dead-letter queue via job failure
          if (criticalCount > 0) {
            throw new Error(
              `Critical reconciliation mismatches detected: ${criticalCount} critical issues found`
            );
          }
        }
        
        if (result.errors.length > 0) {
          const sanitizedErrors = result.errors.map(sanitizeStellarDiagnostic);
          console.error(
            `[ReconciliationWorker] Reconciliation completed with errors:`,
            sanitizeJsonForStellarDiagnostics(sanitizedErrors)
          );
          throw new Error(`Reconciliation errors: ${sanitizedErrors.join(', ')}`);
        }
        
        console.log(
          `[ReconciliationWorker] Job ${job.id} completed successfully. ` +
          `Checked ${result.totalChecked} records.`
        );
      } catch (error) {
        console.error(`[ReconciliationWorker] Job ${job.id} failed:`, sanitizeStellarDiagnostic(error));
        throw error; // Re-throw to trigger job retry logic
      }
    });
  }

  /**
   * Start the reconciliation worker with scheduled runs.
   */
  start(config: ReconciliationWorkerConfig = {}): void {
    if (this.running) {
      console.warn('[ReconciliationWorker] Already running');
      return;
    }

    const intervalMs = config.intervalMs ?? 3600000; // Default: 1 hour
    const runImmediately = config.runImmediately ?? true;

    this.running = true;
    this.jobQueue.start();

    if (runImmediately) {
      console.log('[ReconciliationWorker] Scheduling immediate reconciliation');
      this.reconciliationService.scheduleReconciliation(0);
    }

    this.intervalHandle = setInterval(() => {
      console.log('[ReconciliationWorker] Scheduling periodic reconciliation');
      this.reconciliationService.scheduleReconciliation(0);
    }, intervalMs);

    console.log(
      `[ReconciliationWorker] Started. Running every ${intervalMs}ms ` +
      `(${Math.round(intervalMs / 60000)} minutes)`
    );
  }

  /**
   * Stop the reconciliation worker.
   */
  stop(): void {
    if (!this.running) {
      console.warn('[ReconciliationWorker] Not running');
      return;
    }

    if (this.intervalHandle) {
      clearInterval(this.intervalHandle);
      this.intervalHandle = null;
    }

    this.running = false;
    console.log('[ReconciliationWorker] Stopped');
  }

  isRunning(): boolean {
    return this.running;
  }
}
