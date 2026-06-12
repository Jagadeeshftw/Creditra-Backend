# Troubleshooting Guide

A short, practical checklist for the most common local-development
failures. Search the symptom first, then walk the fix list top-to-bottom.

## "Cannot find module" on import

1. Run `npm install` again to make sure dependencies are present.
2. Confirm `tsconfig.json` has `"moduleResolution": "NodeNext"` and that
   relative imports end in `.js` (TypeScript requires the `.js` suffix
   for ESM emit).
3. Delete `dist/` and rerun `npm run build`.

## Tests pass locally but fail in CI

1. Re-run `npm ci` instead of `npm install` to mirror CI's lockfile-only
   install.
2. Compare Node.js versions: `node -v` should satisfy the `engines.node`
   constraint in `package.json`.
3. Inspect `coverage/` artefacts from the CI run for any environment
   mismatches.

## Database migrations fail to apply

1. Verify `DATABASE_URL` is set and reachable from your machine.
2. Run `npm run db:validate` to check schema invariants before applying
   new migrations.
3. Inspect `migrations/README.md` for the expected ordering convention.

## Stellar / Soroban requests time out

1. Check that the configured Horizon and Soroban RPC endpoints are
   reachable (`curl -I <endpoint>`).
2. Tune timeouts via the environment variables described in
   `docs/http-timeouts.md`.
3. Look for redacted address log lines using `pino-pretty`; raw addresses
   are intentionally masked.

## "Port already in use" when starting the dev server

1. Identify the process holding the port: `lsof -i :3000`.
2. Stop it, or run with `PORT=3001 npm run dev`.
