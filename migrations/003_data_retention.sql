-- Data retention support: anonymization tracking and a retention audit trail.
-- See docs/DATA_RETENTION.md for the policy this enforces.

-- Track when a borrower's PII (wallet_address) was anonymized so the
-- retention job is idempotent and operators can audit when it happened.
ALTER TABLE borrowers ADD COLUMN anonymized_at TIMESTAMPTZ;

CREATE INDEX borrowers_anonymized_at_idx ON borrowers (anonymized_at) WHERE anonymized_at IS NULL;

COMMENT ON COLUMN borrowers.anonymized_at IS 'Set when wallet_address has been irreversibly anonymized by the data retention job; NULL means still identifiable';

-- Immutable record of each retention job run, independent of the `events`
-- table (which is itself subject to retention/purging).
CREATE TABLE data_retention_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  events_deleted INTEGER NOT NULL,
  risk_evaluations_deleted INTEGER NOT NULL,
  borrowers_anonymized INTEGER NOT NULL,
  operational_retention_days INTEGER NOT NULL,
  events_retention_days INTEGER NOT NULL,
  errors JSONB
);

CREATE INDEX data_retention_runs_run_at_idx ON data_retention_runs (run_at DESC);

COMMENT ON TABLE data_retention_runs IS 'Audit trail of data retention job executions; itself retained indefinitely for compliance evidence';
