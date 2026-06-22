# Creditra Backend — Documentation Index

This directory holds the long-form documentation for the Creditra backend. The top-level [`README.md`](../README.md) is the entry point; the documents below go deeper on specific subsystems.

## Start here

| Order | Document | When you need it |
|---|---|---|
| 1 | [`../README.md`](../README.md) | First read — the why, what, and how-to-run. |
| 2 | [`ARCHITECTURE.md`](./ARCHITECTURE.md) | Get the topology, request lifecycle, ER, and worker map in your head. |
| 3 | [`API.md`](./API.md) | Endpoint inventory, request/response shapes, error envelope, pagination. |

## Per-subsystem deep-dives

| Document | Subsystem |
|---|---|
| [`SIGNALS_INGEST.md`](./SIGNALS_INGEST.md) | The behavioral-signal pipeline — Creditra's differentiator. |
| [`INDEXER.md`](./INDEXER.md) | Stellar Horizon listener, cursor model, gap recovery, reconciliation runbook. |
| [`SECURITY.md`](./SECURITY.md) | Threat model and in-tree mitigations. |
| [`DATA_RETENTION.md`](./DATA_RETENTION.md) | Retention windows, anonymization, and deletion tooling for logs, audit events, and wallet-linked data. |
| [`OBSERVABILITY.md`](./OBSERVABILITY.md) | Structured logging, metrics, health probes, tracing strategy. |
| [`TESTING.md`](./TESTING.md) | Test pyramid, file counts, coverage gate, run commands. |
| [`../CONTRIBUTING.md`](../CONTRIBUTING.md) | Commit conventions, PR / review checklists, migration discipline. |

## Reference

| Document | Purpose |
|---|---|
| [`data-model.md`](./data-model.md) | Per-table column reference. |
| [`REPOSITORY_ARCHITECTURE.md`](./REPOSITORY_ARCHITECTURE.md) | Repository / DIP layout. |
| [`schema-validation.md`](./schema-validation.md) | Boot-time schema validator. |
| [`cursor-pagination.md`](./cursor-pagination.md) | Cursor pagination contract. |
| [`error-envelope.md`](./error-envelope.md) | `{ data, error }` envelope reference. |
| [`http-timeouts.md`](./http-timeouts.md) | Outbound HTTP timeout policy. |
| [`HORIZON_LISTENER_CONFIG.md`](./HORIZON_LISTENER_CONFIG.md) | Env-var reference for the listener. |
| [`reconciliation.md`](./reconciliation.md) | Reconciliation job details. |
| [`load-testing.md`](./load-testing.md) | k6 scripts and thresholds. |
| [`security-checklist-backend.md`](./security-checklist-backend.md) | Pre-deploy security checklist. |
| [`security-pentest-checklist.md`](./security-pentest-checklist.md) | Pentest prep checklist. |
| [`troubleshooting.md`](./troubleshooting.md) | Common failure modes. |
| [`utils.md`](./utils.md) | Utility module index. |
| [`getting-started.md`](./getting-started.md) | Onboarding walkthrough. |
| [`commit-conventions.md`](./commit-conventions.md) | Commit format (also covered in `CONTRIBUTING.md`). |
| [`openapi.yaml`](./openapi.yaml) | Mirror of `src/openapi.yaml`. |

## Authoritative spec

The machine-readable API spec is [`../src/openapi.yaml`](../src/openapi.yaml), served at `/docs` (Swagger UI) and `/docs.json` (raw) by `src/index.ts`. When the human docs and the spec disagree, the spec wins — and please open a PR.

## Contributing to docs

Same rules as code:

- Conventional commits (`docs: ...`).
- Mermaid for diagrams (rendered natively on GitHub).
- Absolute or repo-relative links — never click-through-only.
- Every claim grounded in a real file path; link to it.

See [`../CONTRIBUTING.md`](../CONTRIBUTING.md) for the full review checklist.
