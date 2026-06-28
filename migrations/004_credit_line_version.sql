-- Optimistic-locking version column for credit_lines.
-- Incremented on every successful update so concurrent writers can detect
-- lost-update conflicts (PostgresCreditLineRepository.update). See issue #223.

ALTER TABLE credit_lines
  ADD COLUMN IF NOT EXISTS version INTEGER NOT NULL DEFAULT 1;

COMMENT ON COLUMN credit_lines.version IS 'Optimistic-locking version; incremented on each update';
