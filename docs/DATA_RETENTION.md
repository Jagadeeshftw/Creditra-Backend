# Data Retention Policy

This document defines retention windows for logs, audit records, and
wallet-address-linked data, and describes the tooling that enforces them. It
complements [`SECURITY.md`](./SECURITY.md) (log redaction, threat model) and
[`data-model.md`](./data-model.md) (schema reference).

---

## 1. Scope

| Data category | Where it lives | Contains wallet address? |
|---|---|---|
| Application logs (request/error logs) | stdout via Pino, shipped to whatever log sink the deployment uses | Yes, until redacted — see §2 |
| Immutable domain/audit events | `events` table | Sometimes, via `payload` (JSONB) |
| Borrower identity | `borrowers.wallet_address` | Yes — this is the single source of truth; no other table stores a raw wallet address |
| Risk evaluations | `risk_evaluations` | No (joins to `borrowers` via `borrower_id`) |
| Credit lines / transactions | `credit_lines`, `transactions` | No (joins via `borrower_id` / `credit_line_id`) |
| Retention job audit trail | `data_retention_runs` | No — counts only |

Because `wallet_address` exists in exactly one column (`borrowers.wallet_address`), the retention job only needs to delete/anonymize in that one place to remove a wallet's identifying data; everything else is already de-identified by foreign key.

---

## 2. Logs

Stellar public/secret/muxed addresses and emails are redacted **before** they reach the logger, by [`redactLogArgs`/`redactLogValue`](../src/utils/logRedact.ts):

- Stellar public addresses (`G...`) are truncated to `G...xxxx`, not fully removed (kept for debugging continuity).
- Secret seeds (`S...`) and muxed accounts (`M...`) are fully replaced.
- Emails are fully replaced.

This is applied in [`requestLogger`](../src/middleware/requestLogger.ts) and wherever `logRedact` helpers are used. Log retention itself (how long the log *sink* keeps redacted log lines) is an infrastructure concern outside this repo — set the retention policy on whatever log aggregator/SIEM ingests stdout (e.g. CloudWatch Logs retention, Datadog index retention). Recommendation: **30–90 days** for application logs, since they are operational/debugging data, not the system of record (the database is).

---

## 3. Retention windows (database)

| Data | Retention window | Disposal method | Rationale |
|---|---|---|---|
| `events` (audit/domain events) | **365 days** (`DATA_RETENTION_EVENTS_DAYS`) | Hard delete | Audit trails are kept longer than operational data to cover dispute/compliance review windows; events are immutable and not joined by FK, so deletion is safe. |
| `risk_evaluations` | **90 days** (`DATA_RETENTION_OPERATIONAL_DAYS`), and only for borrowers with **no active credit line** | Hard delete | Historical risk snapshots for closed-out borrowers have no ongoing operational use. Evaluations for borrowers with an active credit line are never purged, regardless of age. |
| `borrowers.wallet_address` | **90 days** of inactivity (`DATA_RETENTION_OPERATIONAL_DAYS`), and only for borrowers with **no active credit line** | Anonymize (one-way hash) | `credit_lines`, `transactions`, and `risk_evaluations` reference `borrower_id` and must remain intact for historical reporting and reconciliation — so the row is kept, but the identifying `wallet_address` is replaced with `anon_<sha256>` and `anonymized_at` is set. This is irreversible. |
| `data_retention_runs` (this job's own audit trail) | Indefinite | N/A | Kept as compliance evidence that the policy is actually being enforced. |

"Active" means the borrower has at least one `credit_lines` row with `status = 'active'`. "Inactivity" is the most recent of: `borrowers.updated_at`, any of its `credit_lines.updated_at`, `transactions.created_at`, or `risk_evaluations.evaluated_at`.

These defaults are configurable per-deployment — see §5.

---

## 4. Enforcement

[`DataRetentionService`](../src/services/dataRetentionService.ts) implements three operations, all idempotent and safe to re-run:

- `purgeExpiredEvents(retentionDays)` — `DELETE FROM events WHERE created_at < now() - retentionDays`.
- `purgeStaleRiskEvaluations(retentionDays)` — deletes evaluations older than the window for borrowers with no active credit line.
- `anonymizeStaleBorrowers(retentionDays)` — replaces `wallet_address` with `'anon_' || sha256(borrower_id)` and sets `anonymized_at`, for inactive borrowers with no active credit line. Borrowers already anonymized (`anonymized_at IS NOT NULL`) are skipped.

[`DataRetentionWorker`](../src/services/dataRetentionWorker.ts) schedules a sweep on the shared in-memory job queue (same pattern as [`ReconciliationWorker`](../src/services/reconciliationWorker.ts)), with retry/dead-letter semantics. It is wired into [`Container`](../src/container/Container.ts) and started from [`src/index.ts`](../src/index.ts) alongside the reconciliation worker. It only runs when a Postgres connection is configured (`DATABASE_URL` set) — in-memory/test mode is a no-op.

Every run — scheduled or manual — is recorded in `data_retention_runs` (rows deleted/anonymized per category, configured windows, and any errors), giving an audit trail that the policy is enforced even if no rows happened to be affected.

---

## 5. Configuration

Environment variables (see [`.env.example`](../.env.example)):

| Variable | Default | Meaning |
|---|---|---|
| `DATA_RETENTION_ENABLED` | `true` | Set to `false` to disable the scheduled worker entirely. |
| `DATA_RETENTION_INTERVAL_MS` | `86400000` (24h) | How often the scheduled sweep runs. |
| `DATA_RETENTION_RUN_IMMEDIATELY` | `false` | Run a sweep on boot in addition to the schedule. |
| `DATA_RETENTION_OPERATIONAL_DAYS` | `90` | Retention window for risk evaluations and borrower anonymization. |
| `DATA_RETENTION_EVENTS_DAYS` | `365` | Retention window for the `events` audit log. |

---

## 6. Manual / on-demand operation

Use the CLI for ad-hoc runs (e.g. responding to a deletion request, or auditing before changing the policy):

```bash
# Preview affected row counts — no mutation
DATABASE_URL=... npm run db:retention -- --dry-run

# Apply with custom windows
DATABASE_URL=... npm run db:retention -- --apply --operational-days 90 --events-days 365
```

See [`src/db/data-retention-cli.ts`](../src/db/data-retention-cli.ts) `--help` for all flags. **Always run `--dry-run` first** — anonymization is irreversible (the original `wallet_address` is not recoverable from the hash).

### Honoring an individual deletion/anonymization request

If a borrower (or regulator) requests early deletion ahead of the standard window, anonymize that one borrower directly:

```sql
UPDATE borrowers
SET wallet_address = 'anon_' || encode(digest(id::text, 'sha256'), 'hex'),
    anonymized_at = now()
WHERE wallet_address = $1
  AND anonymized_at IS NULL;
```

This does not delete `credit_lines`, `transactions`, or `risk_evaluations` — those contain no wallet address and are needed for financial record-keeping (run `purgeStaleRiskEvaluations` separately if those should also be purged early).

---

## 7. Operational checklist

- [ ] Migration `003_data_retention.sql` applied (`npm run db:migrate`) — adds `borrowers.anonymized_at` and `data_retention_runs`.
- [ ] `DATABASE_URL` set in production so the worker is active (it's a no-op without it).
- [ ] Log sink retention configured separately (CloudWatch/Datadog/etc.) per §2.
- [ ] `DATA_RETENTION_OPERATIONAL_DAYS` / `DATA_RETENTION_EVENTS_DAYS` reviewed against current compliance requirements before go-live — the defaults here are a reasonable starting point, not a substitute for legal/compliance sign-off.
- [ ] `data_retention_runs` checked periodically (e.g. in the same dashboard as `ReconciliationWorker` alerts) to confirm sweeps are running and not erroring.
