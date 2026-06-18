# Credit Reconciliation Job

## Overview

The credit reconciliation job compares on-chain Credit contract records with database credit lines and flags any drift between the two sources of truth. This ensures data consistency between the blockchain and the backend database.

## Architecture

### Components

1. **ReconciliationService** (`src/services/reconciliationService.ts`)
   - Core reconciliation logic
   - Compares DB records with on-chain data
   - Identifies and categorizes mismatches (critical vs warning)

2. **ReconciliationWorker** (`src/services/reconciliationWorker.ts`)
   - Registers job handler with the job queue
   - Schedules periodic reconciliation runs
   - Handles alerts and dead-letter queue for persistent failures

3. **SorobanClient** (`src/services/sorobanClient.ts`)
   - Interfaces with Soroban RPC to fetch on-chain credit records
   - Currently a mock implementation (replace with actual Soroban SDK calls)

4. **Reconciliation Routes** (`src/routes/reconciliation.ts`)
   - Admin endpoints for manual triggers and status checks

## Configuration

Environment variables:

```bash
# Soroban RPC configuration
SOROBAN_RPC_URL=https://soroban-testnet.stellar.org
CREDIT_CONTRACT_ID=<your-contract-id>
STELLAR_NETWORK_PASSPHRASE=Test SDF Network ; September 2015

# Reconciliation worker configuration
RECONCILIATION_INTERVAL_MS=3600000  # Default: 1 hour
RECONCILIATION_RUN_IMMEDIATELY=true  # Run on startup
```

## API Endpoints

### POST /api/reconciliation/trigger

Manually trigger a reconciliation job (admin only).

**Authentication**: Requires `X-API-Key` header

**Response** (202):
```json
{
  "data": {
    "jobId": "job-123",
    "message": "Reconciliation job scheduled"
  },
  "error": null
}
```

### GET /api/reconciliation/status

Get reconciliation worker status (admin only).

**Authentication**: Requires `X-API-Key` header

**Response** (200):
```json
{
  "data": {
    "workerRunning": true,
    "queueSize": 2,
    "failedJobs": 0
  },
  "error": null
}
```

## Mismatch Detection

The reconciliation service compares the following fields:

Records are paired by trimmed borrower wallet address. If either the database
or on-chain source returns duplicate rows for the same borrower wallet, the pass
records an error and stops instead of overwriting one row with another.

| Field | Severity | Description |
|-------|----------|-------------|
| existence | critical | Record exists in one system but not the other |
| walletAddress | critical | Wallet address mismatch |
| creditLimit | critical | Credit limit mismatch |
| status | critical | Status mismatch (active, suspended, closed) |
| availableCredit | warning | Available credit mismatch |
| interestRateBps | warning | Interest rate mismatch |

## Alerting

When mismatches are detected:

1. **Warning-level mismatches**: Logged but job succeeds
2. **Critical mismatches**: Job fails and enters retry logic
3. **Persistent failures**: After max attempts (default: 3), job moves to dead-letter queue

Failed jobs can be inspected via the `/api/reconciliation/status` endpoint.

## Production Implementation

To integrate with actual Soroban contracts:

1. Install Stellar SDK:
   ```bash
   npm install @stellar/stellar-sdk
   ```

2. Replace `MockSorobanClient` in `src/services/sorobanClient.ts`:
   ```typescript
   import { SorobanRpc, Contract } from '@stellar/stellar-sdk';
   
   export class SorobanClient implements SorobanRpcClient {
     private server: SorobanRpc.Server;
     
     constructor(private config: SorobanClientConfig) {
       this.server = new SorobanRpc.Server(config.rpcUrl);
     }
     
     async fetchAllCreditRecords(): Promise<OnChainCreditRecord[]> {
       // Call contract method to list all credit lines
       // Parse XDR responses into OnChainCreditRecord format
     }
   }
   ```

3. Update Container to use real SorobanClient instead of MockSorobanClient

## Security Considerations

- API endpoints require admin authentication (X-API-Key)
- Soroban RPC calls should use read-only operations
- No private keys are stored or used (read-only reconciliation)
- Failed jobs redact Stellar public keys and secret seeds before logging
- Consider rate limiting for manual trigger endpoint

## Testing

Run tests:
```bash
npm test src/services/__tests__/reconciliationService.test.ts
npm test src/services/__tests__/reconciliationWorker.test.ts
npm test src/services/__tests__/sorobanClient.test.ts
npm test src/routes/__tests__/reconciliation.test.ts
```

Coverage target: ≥95% on all reconciliation modules.

## Monitoring

Monitor the following metrics:

- Reconciliation job success/failure rate
- Number of mismatches detected per run
- Job queue size and processing time
- Failed job count in dead-letter queue

## Operational Notes

- Worker starts automatically on application startup
- Default interval: 1 hour (configurable via env var)
- Jobs retry up to 3 times with 500ms backoff
- Critical mismatches trigger alerts (console.error)
- Failed jobs remain in queue for inspection
