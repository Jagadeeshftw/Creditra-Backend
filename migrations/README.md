# Migrations

SQL migrations for the Creditra PostgreSQL schema. The data model is documented in [docs/data-model.md](../docs/data-model.md).

## Strategy

- **Location:** All migration files live in this directory.
- **Naming:** `NNN_short_snake_case_description.sql` (e.g. `001_initial_schema.sql`). Use three-digit sequence numbers and underscores; no spaces.
- **Order:** Migrations are applied in lexicographic filename order. Never edit or delete a migration that has already been applied in any environment.
- **Tracking:** The table `schema_migrations` stores applied versions (`version` primary key, `applied_at`). Your deployment process should run only migrations whose `version` is not yet present.
- **Rollback:** This project does not ship automatic down-migrations. Document rollback steps (e.g. `DROP TABLE ...`) in migration comments or a runbook when needed.
- **Conventions:** Tables and columns use `snake_case`; PKs are `id` (uuid); FKs are `{entity}_id`; timestamps are `created_at` / `updated_at` (timestamptz).

## Applying migrations

### Using psql

```bash
export DATABASE_URL="postgresql://user:pass@host:5432/dbname?sslmode=require"
psql "$DATABASE_URL" -f migrations/001_initial_schema.sql
```

### Using the project script

From the repo root:

```bash
npm run db:migrate
```

Requires `DATABASE_URL` in the environment. The script applies pending migrations and records them in `schema_migrations`.

## Validating the schema

To validate that the schema applies cleanly and expected tables exist (e.g. in CI):

```bash
npm run db:validate
```

This runs the initial migration (or all pending migrations) and checks for the presence of the core tables. Requires a running PostgreSQL instance and `DATABASE_URL`.

## Files

| File                     | Description                    |
|--------------------------|--------------------------------|
| `001_initial_schema.sql` | Borrowers, credit lines, risk evaluations, transactions, events, indexes |
| `002_add_interest_rate_to_credit_lines.sql` | Adds `interest_rate_bps` to `credit_lines` |
| `003_data_retention.sql` | Adds `borrowers.anonymized_at` and the `data_retention_runs` audit table — see [docs/DATA_RETENTION.md](../docs/DATA_RETENTION.md) |
