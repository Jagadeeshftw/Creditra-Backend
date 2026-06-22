# Security Model

This document is the backend's threat model and the catalogue of in-tree mitigations. It complements the deploy-time checklists in [`docs/security-checklist-backend.md`](./security-checklist-backend.md) and [`docs/security-pentest-checklist.md`](./security-pentest-checklist.md), and the disclosure policy in the repo-root [`SECURITY.md`](../SECURITY.md).

---

## 1. Threat Model (at a glance)

| Asset | Threat | In-tree mitigation |
|---|---|---|
| Risk evaluations | Forgery / replay of risk inputs | Server-derived only — never trust client-supplied factors. `RiskEvaluationService` ignores anything but `walletAddress` + `forceRefresh`. |
| Credit-line state transitions | Unauthorised suspend/close | `X-Admin-Api-Key` gate with constant-time comparison ([`adminAuth.ts`](../src/middleware/adminAuth.ts)) + 503 fail-closed when key unset |
| Outbound webhooks | Spoofed delivery / replay | HMAC-SHA256 signature, monotonic `X-Webhook-Timestamp`, `drawId` for dedup |
| API keys | Timing leaks during comparison | `crypto.timingSafeEqual` in [`auth.ts`](../src/middleware/auth.ts) |
| Logs | PII / secret exfiltration | `redactLogArgs`, Stellar public/secret/muxed account masking, email masking, and `sanitizeWallet` truncation |
| DB | Drift from on-chain truth | `ReconciliationWorker` runs every `RECONCILIATION_INTERVAL_MS` |
| Borrower PII (wallet address) | Indefinite retention of identifying data | `DataRetentionWorker` anonymizes inactive borrowers' `wallet_address` and purges stale audit/risk data — see [`docs/DATA_RETENTION.md`](./DATA_RETENTION.md) |
| Service availability | Brute force / abusive scrapers | Token-bucket rate limit with `Retry-After` |
| Service availability | Large body payloads | 100 kB body cap, 413 mapped to envelope |
| Outbound calls | Slow / hung dependencies | `fetchWithTimeout` connect+read timeouts |

---

## 2. Authentication Model

### 2.1 API key (`X-API-Key`)

[`src/middleware/auth.ts`](../src/middleware/auth.ts) ships a factory:

```ts
createApiKeyMiddleware(validKeysOrResolver: Set<string> | () => Set<string>)
```

- Either a fixed set (tests) or a resolver invoked **per request** (production). The production wiring in [`src/routes/risk.ts`](../src/routes/risk.ts) and [`src/routes/reconciliation.ts`](../src/routes/reconciliation.ts) passes `() => loadApiKeys()`, so rotating `API_KEYS` in the secret store takes effect on the next request — no restart required.
- Comparison uses `crypto.timingSafeEqual` and the keys are encoded to bytes of identical length before comparison.
- The provided key value is **never** included in logs, error messages, or responses.
- Status semantics:
  - `401 Unauthorized` — header absent (caller is unaware of auth).
  - `403 Forbidden` — header present but invalid (caller is being told "your key is wrong" without disclosing which valid keys exist).

### 2.2 Admin key (`X-Admin-Api-Key`)

A separate, single-secret header in [`src/middleware/adminAuth.ts`](../src/middleware/adminAuth.ts). Distinct so the public API-key set can be granted to integration partners without unlocking destructive operations.

Fail-closed: when `ADMIN_API_KEY` is unset, the endpoint returns `503` so operators discover the misconfiguration rather than silently accepting any request.

### 2.3 Where session/JWT would live

No JWT or cookie auth ships today. If introduced, recommended placement:

- Issuance in a new `routes/auth.ts`.
- Verification in a new middleware sibling to `auth.ts`, sharing the envelope conventions and `timingSafeEqual` pattern.
- Refresh tokens stored hashed in a new table; never logged.

---

## 3. Role-Based Access Control

Two roles ship in code; everything else is read-public:

| Role | Header | Gated endpoints |
|---|---|---|
| `api-key` (partner / integration) | `X-API-Key` | `POST /api/risk/admin/recalibrate`, `/api/reconciliation/*` |
| `admin` (operator) | `X-Admin-Api-Key` | `POST /api/credit/lines/:id/suspend`, `.../close` |

Both middlewares register **after** rate-limit but **before** the handler so an unauthenticated client can still be throttled. New roles should follow the same pattern.

---

## 4. Input Validation Policy

Every external boundary validates via Zod ([`src/schemas/`](../src/schemas/)). Three middleware factories wrap the schemas — body, query, params — from [`src/middleware/validate.ts`](../src/middleware/validate.ts):

```ts
validateBody(schema)   // replaces req.body with parsed value
validateQuery(schema)  // replaces req.query
validateParams(schema) // replaces req.params
```

Behaviour:

- On failure → `400` with structured `{ field, message }[]`.
- On success → the parsed (and coerced) value **replaces** the raw input, so downstream handlers receive well-typed data.
- All credit/risk endpoints reject unknown keys via `additionalProperties: false`.
- Stellar address validation lives in [`stellarAddress.ts`](../src/utils/stellarAddress.ts) (regex `/^G[A-Z2-7]{55}$/`) and is shared by `walletAddressSchema` and `walletAddressParamSchema`.

Validator chain order:

1. CORS allowlist ([`src/config/cors.ts`](../src/config/cors.ts))
2. JSON body parser (100 kB)
3. Content-Type guard (returns 415 if `POST/PUT/PATCH` has a body that isn't `application/json`)
4. Request logger (assigns / propagates `x-request-id`)
5. Auth middleware (route-specific)
6. Rate limit middleware (route-specific)
7. Zod validate(Body|Query|Params)
8. Handler
9. `errorHandler` catches anything unhandled

---

## 5. Rate Limiting Strategy

Implementation: [`src/middleware/rateLimit.ts`](../src/middleware/rateLimit.ts) — fixed-window token bucket per key.

Knobs:

```env
RATE_LIMIT_WINDOW_MS=60000       # window length
RATE_LIMIT_MAX_REQUESTS=100      # generic per-route ceiling
RATE_LIMIT_MAX_EVALUATE=10       # per-route override for /api/risk/evaluate
```

Key generators:

- `createIpKeyGenerator()` — uses `X-Forwarded-For` first hop, falls back to `req.ip`.
- `createApiKeyKeyGenerator()` — keys by API key when supplied, otherwise IP.

Headers on every response:

```
X-RateLimit-Limit: <limit>
X-RateLimit-Remaining: <remaining>
X-RateLimit-Reset: <epoch seconds>
```

429 also returns `Retry-After: <seconds>` and the envelope:

```json
{ "data": null, "error": "Too many requests. Please retry after N seconds.", "retryAfter": N }
```

Limits are in-process; a horizontally scaled deployment should swap the `Map` for a Redis-backed store (the keyGenerator and option contract are untouched).

---

## 6. Idempotency

Three independent layers:

| Layer | Mechanism | File |
|---|---|---|
| Inbound writes | `events.idempotency_key` partial-unique index | `migrations/001_initial_schema.sql` |
| Indexer | `eventId = SHA256(ledger || contractId || topics || data)` + 10 000-entry LRU set | [`horizonListener.ts`](../src/services/horizonListener.ts) |
| Outbound webhooks | Stable `drawId` in payload + retry-aware subscribers | [`drawWebhookService.ts`](../src/services/drawWebhookService.ts) |

---

## 7. Webhook Signature Verification

The backend ships **outbound** webhooks (no inbound webhook surface today). Each delivery includes:

```http
X-Webhook-Signature: sha256=<hex HMAC over raw body>
X-Webhook-Timestamp: <ms epoch>
User-Agent: Creditra-Webhook/1.0
```

Producer:

- Secret loaded from `WEBHOOK_SECRET` — refuses to start (`getWebhookConfig()` returns `null`) when URLs are configured without a secret.
- HMAC computed over the **raw JSON body** prior to send; subscribers should validate against the body bytes they received, not a re-serialized form.
- Retries up to `WEBHOOK_MAX_RETRIES + 1` with `WEBHOOK_INITIAL_BACKOFF_MS × multiplier^attempt`.

Subscriber expectation (documented in [`docs/API.md`](./API.md) §Webhooks):

1. Recompute `HMAC-SHA256(body, secret)` and compare in constant time.
2. Reject deliveries older than your tolerance window (`X-Webhook-Timestamp`).
3. Deduplicate by `data.drawId`.

---

## 8. Secret Management

- **Sources.** All secrets enter through environment variables — see [`.env.example`](../.env.example) for the canonical list. The container loaders in [`src/config/`](../src/config/) are the only code paths that read them.
- **Validation.** `validateEnv()` in [`src/config/env.ts`](../src/config/env.ts) asserts presence of `DATABASE_URL` and `API_KEYS` at boot and refuses to start otherwise. Production additionally requires `CORS_ORIGINS` ([`src/config/cors.ts`](../src/config/cors.ts)).
- **Rotation.** `loadApiKeys()` is invoked per-request via a resolver closure so partner keys can be rotated by updating the env source (e.g. Kubernetes Secret + restart-free reload) without redeploying.
- **Out of logs.** The Pino-based [`logger`](../src/utils/logger.ts) is paired with [`logRedact.ts`](../src/utils/logRedact.ts) which:
  - Redacts Stellar pubkeys (`G[A-Z2-7]{55}`) to `Gxxxxx...xxxx` form.
  - Masks Stellar secret seeds, muxed accounts, and email addresses.
  - Walks nested objects and `Error.message`.
  - Is opt-out via `LOG_REDACTION_DEBUG` for incident response.
- **Sanitized errors.** [`sorobanRpcClient`](../src/services/sorobanRpcClient.ts) strips Stellar keys from any thrown error before propagation.
- **No `.env` in image.** `Dockerfile` deliberately omits the env file; secrets must be injected at runtime.

---

## 9. Audit Logging

- **Request lifecycle.** [`requestLogger.ts`](../src/middleware/requestLogger.ts) logs `request:start` and `request:end` with `{ requestId, method, path, statusCode, durationMs, walletAddress (sanitized) }`. The same `requestId` is propagated to the response via `x-request-id`.
- **Domain events.** Persisted to the `events` table with `event_type`, `aggregate_type/id`, JSONB `payload`, `idempotency_key` for replay safety, and `created_at`. Indexed on `(aggregate_type, aggregate_id)` and `created_at` for time-range queries.
- **Reconciliation.** Each reconciliation pass emits a `ReconciliationResult` containing per-line `mismatches[]` (with severity) and `errors[]`. Critical mismatches cause the worker to throw, retrying via the job queue and surfacing to monitoring.
- **Listener.** `HorizonListener.getMetrics()` exposes counters useful for SIEM ingestion: `failedPolls`, `rateLimitHits`, `cursorGapsDetected`, etc.

---

## 10. Defence-in-Depth Quick Reference

| Concern | Where to look |
|---|---|
| CSRF | Not applicable — no cookie/session auth; explicit `X-API-Key` header foils CSRF |
| Open redirect | No redirect endpoints — `swagger-ui-express` serves static |
| XSS | API returns JSON only; never renders user content |
| SQL injection | All queries via parameterized `pg.Client.query(text, values)` |
| SSRF | Outbound URLs are constrained: Horizon, Soroban, configured webhook URLs only; all guarded by `fetchWithTimeout` |
| Dependency tampering | Lockfile committed; CI runs `npm audit --audit-level=moderate` ([`.github/workflows/backend-ci.yml`](../.github/workflows/backend-ci.yml)); Dependency Review on PRs |
| Container hardening | `Dockerfile` runs as non-root `node` user, multi-stage build, Alpine runtime |
| Slowloris / connection abuse | Reverse proxy (deployment concern); we time-bound outbound, not inbound — pair with nginx/envoy timeouts |
| Shutdown DoS | `SHUTDOWN_TIMEOUT_MS` ceiling prevents stuck shutdowns blocking orchestrator restarts |

---

## 11. Reporting a vulnerability

See the repo-root [`SECURITY.md`](../SECURITY.md). In short: **do not** open a public issue; email the security alias. Include reproduction steps, observed vs expected behavior, and the affected commit SHA. We commit to acknowledging within 72 hours.

---

## 12. References

- [`SECURITY.md`](../SECURITY.md) — disclosure policy
- [`docs/security-checklist-backend.md`](./security-checklist-backend.md) — pre-deploy checklist
- [`docs/security-pentest-checklist.md`](./security-pentest-checklist.md) — pentest scope guide
- [`docs/http-timeouts.md`](./http-timeouts.md) — outbound HTTP timeout policy
