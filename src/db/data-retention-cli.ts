#!/usr/bin/env node
/**
 * CLI: run (or preview) a data retention sweep on demand.
 *
 * See docs/DATA_RETENTION.md for the policy this enforces.
 *
 * Usage:
 *   DATABASE_URL=... node --import tsx src/db/data-retention-cli.ts --dry-run
 *   DATABASE_URL=... node --import tsx src/db/data-retention-cli.ts --apply
 *   DATABASE_URL=... node --import tsx src/db/data-retention-cli.ts --apply --operational-days 90 --events-days 365
 *
 * Safety: defaults to dry-run (counts only, no mutation). Mutating the
 * database requires the explicit --apply flag.
 */
import { getConnection } from './client.js';
import { DataRetentionService, DEFAULT_OPERATIONAL_RETENTION_DAYS, DEFAULT_EVENTS_RETENTION_DAYS } from '../services/dataRetentionService.js';

interface CliArgs {
  apply: boolean;
  operationalDays: number;
  eventsDays: number;
  help: boolean;
}

function parseArgs(): CliArgs {
  const args = process.argv.slice(2);
  const result: CliArgs = {
    apply: false,
    operationalDays: DEFAULT_OPERATIONAL_RETENTION_DAYS,
    eventsDays: DEFAULT_EVENTS_RETENTION_DAYS,
    help: false,
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    switch (arg) {
      case '--apply':
        result.apply = true;
        break;
      case '--dry-run':
        result.apply = false;
        break;
      case '--operational-days':
        if (i + 1 < args.length) result.operationalDays = parseInt(args[++i], 10);
        break;
      case '--events-days':
        if (i + 1 < args.length) result.eventsDays = parseInt(args[++i], 10);
        break;
      case '--help':
      case '-h':
        result.help = true;
        break;
    }
  }

  return result;
}

function showHelp(): void {
  console.log(`
Creditra Data Retention CLI

USAGE:
  DATABASE_URL=... node --import tsx src/db/data-retention-cli.ts [OPTIONS]

OPTIONS:
  --dry-run                  Preview affected row counts without changing data (default)
  --apply                    Actually purge/anonymize data
  --operational-days <n>     Retention window for risk evaluations & borrower PII (default: ${DEFAULT_OPERATIONAL_RETENTION_DAYS})
  --events-days <n>          Retention window for the events audit log (default: ${DEFAULT_EVENTS_RETENTION_DAYS})
  --help, -h                 Show this help message

NOTES:
  - Anonymization is irreversible: wallet_address is replaced with a one-way
    hash. Always run --dry-run first and review the counts.
  - Every --apply run is recorded in data_retention_runs for audit purposes.
`);
}

async function main(): Promise<void> {
  const args = parseArgs();

  if (args.help) {
    showHelp();
    return;
  }

  const client = getConnection();
  try {
    if (client.connect) await client.connect();
    await client.query('SELECT 1');
  } catch {
    console.error('❌ Cannot connect to database. Set DATABASE_URL.');
    process.exitCode = 1;
    return;
  }

  const config = {
    operationalRetentionDays: args.operationalDays,
    eventsRetentionDays: args.eventsDays,
  };

  const service = new DataRetentionService(client);

  try {
    if (!args.apply) {
      console.log('🔍 DRY RUN — previewing affected rows, no changes will be made');
      console.log(`   Operational retention: ${config.operationalRetentionDays} days`);
      console.log(`   Events retention: ${config.eventsRetentionDays} days`);
      console.log('');

      const preview = await service.preview(config);
      console.log(`Events that would be deleted:            ${preview.eventsDeleted}`);
      console.log(`Risk evaluations that would be deleted:  ${preview.riskEvaluationsDeleted}`);
      console.log(`Borrowers that would be anonymized:      ${preview.borrowersAnonymized}`);
      if (preview.errors.length > 0) {
        console.error('Errors during preview:', preview.errors);
        process.exitCode = 1;
      }
      console.log('');
      console.log('Re-run with --apply to perform this sweep.');
      return;
    }

    console.log('🚀 Applying data retention sweep...');
    const result = await service.run(config);
    console.log(`Events deleted:            ${result.eventsDeleted}`);
    console.log(`Risk evaluations deleted:  ${result.riskEvaluationsDeleted}`);
    console.log(`Borrowers anonymized:      ${result.borrowersAnonymized}`);

    if (result.errors.length > 0) {
      console.error('⚠️  Completed with errors:', result.errors);
      process.exitCode = 1;
    } else {
      console.log('✅ Retention sweep complete.');
    }
  } finally {
    await client.end();
  }
}

void main();
