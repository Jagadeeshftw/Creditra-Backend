/**
 * Data Retention Service
 *
 * Enforces the retention windows defined in docs/DATA_RETENTION.md:
 * - Immutable `events` rows older than `eventsRetentionDays` are hard-deleted.
 * - `risk_evaluations` for borrowers with no active credit line, older than
 *   `operationalRetentionDays`, are hard-deleted (historical snapshots only).
 * - Borrowers with no active credit line whose most recent activity is older
 *   than `operationalRetentionDays` have `wallet_address` irreversibly
 *   anonymized (one-way hash) rather than deleted, since `credit_lines`,
 *   `risk_evaluations`, and `transactions` reference `borrower_id` and must
 *   remain intact for historical reporting and reconciliation.
 *
 * Every run is recorded in `data_retention_runs` for audit purposes.
 */
import type { DbClient } from '../db/client.js';

export interface DataRetentionConfig {
  /** Retention window for risk evaluations and borrower PII, in days. */
  operationalRetentionDays: number;
  /** Retention window for the immutable `events` audit log, in days. */
  eventsRetentionDays: number;
}

export interface DataRetentionResult {
  runAt: Date;
  eventsDeleted: number;
  riskEvaluationsDeleted: number;
  borrowersAnonymized: number;
  errors: string[];
}

export const DEFAULT_OPERATIONAL_RETENTION_DAYS = 90;
export const DEFAULT_EVENTS_RETENTION_DAYS = 365;

export class DataRetentionService {
  constructor(private client: DbClient) {}

  /**
   * Hard-delete `events` rows older than the configured retention window.
   * Returns the number of rows deleted.
   */
  async purgeExpiredEvents(retentionDays: number): Promise<number> {
    const result = await this.client.query(
      `DELETE FROM events
       WHERE created_at < now() - ($1 || ' days')::interval
       RETURNING id`,
      [retentionDays],
    );
    return result.rows.length;
  }

  /**
   * Hard-delete `risk_evaluations` older than the retention window, but only
   * for borrowers with no currently active credit line — active borrowers'
   * risk history is kept regardless of age.
   */
  async purgeStaleRiskEvaluations(retentionDays: number): Promise<number> {
    const result = await this.client.query(
      `DELETE FROM risk_evaluations re
       USING borrowers b
       WHERE re.borrower_id = b.id
         AND re.evaluated_at < now() - ($1 || ' days')::interval
         AND NOT EXISTS (
           SELECT 1 FROM credit_lines cl
           WHERE cl.borrower_id = b.id AND cl.status = 'active'
         )
       RETURNING re.id`,
      [retentionDays],
    );
    return result.rows.length;
  }

  /**
   * Anonymize `wallet_address` for borrowers with no active credit line whose
   * most recent activity (across credit lines, transactions, and risk
   * evaluations) is older than the retention window. Idempotent — already
   * anonymized borrowers (`anonymized_at IS NOT NULL`) are skipped.
   */
  async anonymizeStaleBorrowers(retentionDays: number): Promise<number> {
    const result = await this.client.query(
      `WITH last_activity AS (
         SELECT
           b.id AS borrower_id,
           GREATEST(
             b.updated_at,
             COALESCE(MAX(cl.updated_at), b.updated_at),
             COALESCE(MAX(t.created_at), b.updated_at),
             COALESCE(MAX(re.evaluated_at), b.updated_at)
           ) AS last_active_at,
           BOOL_OR(cl.status = 'active') AS has_active_line
         FROM borrowers b
         LEFT JOIN credit_lines cl ON cl.borrower_id = b.id
         LEFT JOIN transactions t ON t.credit_line_id = cl.id
         LEFT JOIN risk_evaluations re ON re.borrower_id = b.id
         WHERE b.anonymized_at IS NULL
         GROUP BY b.id, b.updated_at
       )
       UPDATE borrowers b
       SET wallet_address = 'anon_' || encode(digest(b.id::text, 'sha256'), 'hex'),
           anonymized_at = now()
       FROM last_activity la
       WHERE b.id = la.borrower_id
         AND la.has_active_line IS NOT TRUE
         AND la.last_active_at < now() - ($1 || ' days')::interval
       RETURNING b.id`,
      [retentionDays],
    );
    return result.rows.length;
  }

  /**
   * Count rows each operation would affect, without mutating anything.
   * Used by the CLI's dry-run mode.
   */
  async preview(config: DataRetentionConfig): Promise<DataRetentionResult> {
    const result: DataRetentionResult = {
      runAt: new Date(),
      eventsDeleted: 0,
      riskEvaluationsDeleted: 0,
      borrowersAnonymized: 0,
      errors: [],
    };

    try {
      const r = await this.client.query(
        `SELECT count(*)::int AS count FROM events
         WHERE created_at < now() - ($1 || ' days')::interval`,
        [config.eventsRetentionDays],
      );
      result.eventsDeleted = (r.rows[0] as { count: number }).count;
    } catch (error) {
      result.errors.push(`previewExpiredEvents: ${error instanceof Error ? error.message : String(error)}`);
    }

    try {
      const r = await this.client.query(
        `SELECT count(*)::int AS count FROM risk_evaluations re
         JOIN borrowers b ON re.borrower_id = b.id
         WHERE re.evaluated_at < now() - ($1 || ' days')::interval
           AND NOT EXISTS (
             SELECT 1 FROM credit_lines cl
             WHERE cl.borrower_id = b.id AND cl.status = 'active'
           )`,
        [config.operationalRetentionDays],
      );
      result.riskEvaluationsDeleted = (r.rows[0] as { count: number }).count;
    } catch (error) {
      result.errors.push(`previewStaleRiskEvaluations: ${error instanceof Error ? error.message : String(error)}`);
    }

    try {
      const r = await this.client.query(
        `WITH last_activity AS (
           SELECT
             b.id AS borrower_id,
             GREATEST(
               b.updated_at,
               COALESCE(MAX(cl.updated_at), b.updated_at),
               COALESCE(MAX(t.created_at), b.updated_at),
               COALESCE(MAX(re.evaluated_at), b.updated_at)
             ) AS last_active_at,
             BOOL_OR(cl.status = 'active') AS has_active_line
           FROM borrowers b
           LEFT JOIN credit_lines cl ON cl.borrower_id = b.id
           LEFT JOIN transactions t ON t.credit_line_id = cl.id
           LEFT JOIN risk_evaluations re ON re.borrower_id = b.id
           WHERE b.anonymized_at IS NULL
           GROUP BY b.id, b.updated_at
         )
         SELECT count(*)::int AS count FROM last_activity la
         WHERE la.has_active_line IS NOT TRUE
           AND la.last_active_at < now() - ($1 || ' days')::interval`,
        [config.operationalRetentionDays],
      );
      result.borrowersAnonymized = (r.rows[0] as { count: number }).count;
    } catch (error) {
      result.errors.push(`previewStaleBorrowers: ${error instanceof Error ? error.message : String(error)}`);
    }

    return result;
  }

  /** Record a completed run in the `data_retention_runs` audit table. */
  async recordRun(
    config: DataRetentionConfig,
    result: Pick<DataRetentionResult, 'eventsDeleted' | 'riskEvaluationsDeleted' | 'borrowersAnonymized' | 'errors'>,
  ): Promise<void> {
    await this.client.query(
      `INSERT INTO data_retention_runs
         (events_deleted, risk_evaluations_deleted, borrowers_anonymized,
          operational_retention_days, events_retention_days, errors)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        result.eventsDeleted,
        result.riskEvaluationsDeleted,
        result.borrowersAnonymized,
        config.operationalRetentionDays,
        config.eventsRetentionDays,
        result.errors.length > 0 ? JSON.stringify(result.errors) : null,
      ],
    );
  }

  /**
   * Run the full retention sweep: purge expired events, purge stale risk
   * evaluations, anonymize stale borrowers, then record the run for audit.
   * Failures in one step do not block the others; all errors are collected
   * and recorded.
   */
  async run(config: DataRetentionConfig): Promise<DataRetentionResult> {
    const result: DataRetentionResult = {
      runAt: new Date(),
      eventsDeleted: 0,
      riskEvaluationsDeleted: 0,
      borrowersAnonymized: 0,
      errors: [],
    };

    try {
      result.eventsDeleted = await this.purgeExpiredEvents(config.eventsRetentionDays);
    } catch (error) {
      result.errors.push(`purgeExpiredEvents: ${error instanceof Error ? error.message : String(error)}`);
    }

    try {
      result.riskEvaluationsDeleted = await this.purgeStaleRiskEvaluations(config.operationalRetentionDays);
    } catch (error) {
      result.errors.push(`purgeStaleRiskEvaluations: ${error instanceof Error ? error.message : String(error)}`);
    }

    try {
      result.borrowersAnonymized = await this.anonymizeStaleBorrowers(config.operationalRetentionDays);
    } catch (error) {
      result.errors.push(`anonymizeStaleBorrowers: ${error instanceof Error ? error.message : String(error)}`);
    }

    try {
      await this.recordRun(config, result);
    } catch (error) {
      result.errors.push(`recordRun: ${error instanceof Error ? error.message : String(error)}`);
    }

    return result;
  }
}
