# Contributing to Creditra Backend

Thank you for your interest in contributing to the **Creditra Backend**!  
We focus on delivering a **secure, tested, documented, and performant API and services** for credit lines, risk evaluation, and future features.2

Before submitting a contribution, please read this guide carefully.

---

##  Getting Started

### 1. Fork & Branch

1. Fork the repository on GitHub.

2. Clone your fork:

   ```bash
   git clone https://github.com/<your-username>/Creditra-Backend.git
   cd Creditra-Backend
```
3. Create a branch for your work:
```bash
git checkout -b docs/backend-contributing
```
4. Make your changes and commit.

## Local Setup

- Prerequisites

- Node.js 20+

- npm (or Yarn)

- PostgreSQL (local or remote)

> Optional: Redis and Horizon if running advanced services

## Install Dependencies
```bash
npm install
```

## Environment Variables
Copy the example and set any required credentials:

```bash
cp .env.example .env
```
Required:
```bash
PORT=3000
DATABASE_URL="postgresql://user:pass@localhost:5432/creditra"
```
> Security: Never commit secrets or real credentials. Use a .env.local file or secret manager for sensitive data.

Run the App

- Development + watch:
```bash
npm run dev
```
- Build & Run:
```bash
npm run build
npm start
```

## Available Scripts
Script                    Description
`npm run dev`             Run server in watch mode
`npm test`                Run tests
`npm run coverage`        Generate test coverage report
`npm run db:migrate`      Apply database migrations
`npm run db:validate`     Validate migration state

# Testing
We use Vitest for unit and integration tests. All new features or changes must include tests.

## Guidelines

- Aim for ≥ 95% test coverage on any new code.

- Tests should be deterministic and not depend on external services.

- Mock external calls where possible.

- Tests should run locally without special setup.

## Run Tests
```bash
npm test
```
- Coverage report:
```bash
npm run coverage
```

# Code Standards
- TypeScript with strict mode

- Follow existing project structure under src/

- Use ESM imports

- API routes should live under src/routes/

- Helpers and utilities under src/utils/

Formatting & Linting

- We recommend consistent formatting:

- Prettier for formatting

- ESLint for linting (if configured)

Before committing, format code:
```bash
npm run lint
```

# Security
Security is a priority.

- Do NOT log secrets, private keys, or wallet private data.

- Validate user inputs at the edge (request layer).

- Always sanitize and escape external input.

- Never commit API keys, private credentials, or production URLs.

- Use safe comparison and hashing for sensitive values.

- Review open security issues before adding features.

Wallet data handling:

- Always treat wallet addresses and signatures as sensitive.

- Avoid logging or exposing wallet‐linked secrets.

- Ensure services that interact with funds follow strict access rules.

## Performance
- Prefer indexed database queries for frequent lookups.

- Avoid N+1 queries.

- Cache read-heavy operations using Redis where appropriate.

- Profile APIs with real data before merging (benchmark and log).

## Code Reviews
To speed review and maintain quality:
- Use concise commit messages (see below)

- Link related issues

- Include test output, coverage results, and screenshots if UI involved

- Always rebase on main before opening a PR

- Describe intent and edge cases in PR description

# Commit & Branch Conventions

## Branch Naming
Use descriptive branch names:
```
feature/<feature-name>
fix/<short-description>
docs/<documentation-area>
chore/<task>
refactor/<area>
```

## Commit Messages — Conventional Commits

Format: `<type>(<scope>): <imperative summary>` — 72 chars or less.

| Type | When | Example |
|---|---|---|
| `feat` | New user-visible feature | `feat(risk): add ExternalApiRiskProvider` |
| `fix` | Bug fix | `fix(reconciliation): retry critical mismatches via job queue` |
| `docs` | Docs only | `docs(security): document HMAC verification` |
| `refactor` | Code change with no behavior change | `refactor(container): extract repository factory` |
| `test` | Adding or modifying tests | `test(creditService): cover suspend → close transition` |
| `perf` | Performance improvement | `perf(rateLimit): reuse window key map` |
| `chore` | Tooling / housekeeping | `chore(deps): bump pino to 10.4.0` |
| `build` | Build / CI changes | `build(ci): add Node 22 to matrix` |

Body (optional) explains the *why*. Footer carries `Closes #N`, `Breaking change:`, or `Co-authored-by:` trailers.

Examples:

```
docs(api): document idempotency contract for webhook subscribers

Subscribers must dedup by data.drawId since retries up to
WEBHOOK_MAX_RETRIES + 1 are expected. Adds a "What subscribers must
implement" subsection to docs/API.md §4.

Closes #142
```

```
fix(horizonListener): cap cursor-gap recovery at HORIZON_MAX_CURSOR_GAP

Recovery loop could iterate indefinitely on a degraded Horizon endpoint.
Now bounded; if recovery fails we skip ahead and let reconciliation catch
the drift.
```

# Migration Discipline

Schema changes are persistent and irreversible in production. They follow strict additive-only discipline:

1. **One migration per PR.** Filename: `NNN_short_description.sql` under `migrations/`.
2. **Additive by default.** Add columns nullable or with a default; backfill in a follow-up; tighten constraints only after a verified backfill.
3. **No `DROP COLUMN` / `DROP TABLE`** without a deprecation cycle. Mark unused columns, stop reading them, deploy, *then* drop in a later release.
4. **Indexes added `CREATE INDEX CONCURRENTLY`** when possible — large tables block writers otherwise.
5. **Update [`src/db/validate-schema.ts`](./src/db/validate-schema.ts)** in the same PR so the boot-time validator knows about the new column / index. CI runs `npm run db:validate`.
6. **Reflect in [`docs/data-model.md`](./docs/data-model.md)** and in `src/openapi.yaml` if the change affects request/response shapes.
7. **Document any data migration** (backfill SQL or script) inline in the migration file or in `docs/`.

# Pull Request Checklist

Before requesting review, confirm:

- [ ] Branch rebased on latest `main`
- [ ] `npm test` passes locally
- [ ] `npm run lint` passes
- [ ] `npm run typecheck` passes
- [ ] `npm run validate:spec` passes (if OpenAPI changed)
- [ ] New code covered by tests; coverage ≥ 95 % on touched modules
- [ ] No new secrets, credentials, or wallet pubkeys in code, tests, fixtures, or logs
- [ ] All Zod schemas updated alongside any new route inputs
- [ ] Migration added under `migrations/` and reflected in `validate-schema.ts` (if DB changed)
- [ ] OpenAPI spec (`src/openapi.yaml`) updated (if API surface changed)
- [ ] Conventional commit message
- [ ] PR description explains *what* and *why*, lists noteworthy edge cases, links related issues

# Review Checklist (for reviewers)

When reviewing, look for:

- **Correctness.** Does each new route path through validation → auth → rate-limit → handler? Are state transitions guarded?
- **Envelope discipline.** Every response uses `ok()` / `fail()` from `src/utils/response.ts`?
- **Idempotency.** Replays handled? Event ids stable? `idempotency_key` written where applicable?
- **Time bounds.** Every outbound HTTP wrapped in `fetchWithTimeout` (or its equivalents)?
- **Secrets.** Any log line that could leak a Stellar key or API key? Use `redactLogArgs` / `sanitizeWallet`.
- **Tests.** Reproduces the change deterministically? No real network? Covers error path?
- **Docs.** README / `docs/` updated if behavior, surface, or env vars changed?
- **Reconcilable.** Does the change preserve the reconciliation invariant: DB state = chain state?

# Performance & Maintenance Expectations

- New endpoints should include performance benchmarks (k6 if user-facing, micro-benchmarks otherwise).
- Regressions in performance must be justified in PR.
- Periodically update dependencies, especially security patches.

# Reporting Vulnerabilities

Do not open a public issue. See [`SECURITY.md`](./SECURITY.md) for the responsible-disclosure channel.

Thank you!
We appreciate your efforts and contributions to making the Creditra Backend secure, tested, and well-documented. If you have any questions, drop a comment on the related issue.
Happy coding!
