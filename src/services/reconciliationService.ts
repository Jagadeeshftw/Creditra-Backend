/**
 * Credit Reconciliation Service
 * 
 * Compares on-chain Credit contract records with CreditLineService database rows
 * and flags drift between the two sources of truth.
 */

import type { CreditLineRepository } from '../repositories/interfaces/CreditLineRepository.js';
import type { CreditLine } from '../models/CreditLine.js';
import type { JobQueue } from './jobQueue.js';
import { sanitizeJsonForStellarDiagnostics, sanitizeStellarDiagnostic } from './stellarDiagnostics.js';

const RECONCILIATION_DB_PAGE_SIZE = 1_000;
const RECONCILIATION_MAX_DB_RECORDS = 10_000;

export interface OnChainCreditRecord {
  /** Contract-level credit line identifier */
  id: string;
  /** Wallet address from the contract */
  walletAddress: string;
  /** Credit limit from the contract (as string for precision) */
  creditLimit: string;
  /** Available credit from the contract */
  availableCredit: string;
  /** Interest rate in basis points */
  interestRateBps: number;
  /** Contract status */
  status: string;
}

export interface ReconciliationMismatch {
  creditLineId: string;
  walletAddress: string;
  field: string;
  dbValue: string | number;
  chainValue: string | number;
  severity: 'critical' | 'warning';
}

export interface ReconciliationResult {
  timestamp: Date;
  totalChecked: number;
  mismatches: ReconciliationMismatch[];
  errors: string[];
}

export interface SorobanRpcClient {
  /**
   * Fetch all credit records from the on-chain contract.
   */
  fetchAllCreditRecords(): Promise<OnChainCreditRecord[]>;
}

export class ReconciliationService {
  constructor(
    private creditLineRepository: CreditLineRepository,
    private sorobanClient: SorobanRpcClient,
    private jobQueue: JobQueue,
  ) {}

  /**
   * Schedule a reconciliation job to run asynchronously.
   */
  scheduleReconciliation(delayMs = 0): string {
    return this.jobQueue.enqueue(
      'credit-reconciliation',
      {},
      { delayMs, maxAttempts: 3 }
    );
  }

  /**
   * Perform reconciliation: compare DB records with on-chain records.
   */
  async reconcile(): Promise<ReconciliationResult> {
    const result: ReconciliationResult = {
      timestamp: new Date(),
      totalChecked: 0,
      mismatches: [],
      errors: [],
    };

    try {
      const dbCreditLines = await fetchAllDbCreditLines(this.creditLineRepository);
      
      // Fetch all credit records from on-chain contract
      const chainRecords = await this.sorobanClient.fetchAllCreditRecords();

      result.totalChecked = Math.max(dbCreditLines.length, chainRecords.length);

      const duplicateDbWallets = findDuplicateWallets(dbCreditLines.map(cl => cl.walletAddress));
      const duplicateChainWallets = findDuplicateWallets(chainRecords.map(cr => cr.walletAddress));
      for (const walletAddress of duplicateDbWallets) {
        result.errors.push(
          reconciliationDiagnostic(`Duplicate database credit lines for borrower wallet ${walletAddress}`),
        );
      }
      for (const walletAddress of duplicateChainWallets) {
        result.errors.push(
          reconciliationDiagnostic(`Duplicate on-chain credit records for borrower wallet ${walletAddress}`),
        );
      }

      if (result.errors.length > 0) {
        console.error(
          '[ReconciliationService] Reconciliation failed:',
          sanitizeJsonForStellarDiagnostics(result.errors)
        );
        return result;
      }

      // The credit contract enumerates stable numeric ids, while the backend DB
      // owns UUID credit-line ids. Borrower wallet address is the shared natural key.
      const dbMap = new Map(dbCreditLines.map(cl => [walletKey(cl.walletAddress), cl]));
      const chainMap = new Map(chainRecords.map(cr => [walletKey(cr.walletAddress), cr]));

      // Check for records in DB but not on chain
      for (const dbLine of dbCreditLines) {
        const chainRecord = chainMap.get(walletKey(dbLine.walletAddress));
        
        if (!chainRecord) {
          result.mismatches.push({
            creditLineId: dbLine.id,
            walletAddress: dbLine.walletAddress,
            field: 'existence',
            dbValue: 'exists',
            chainValue: 'missing',
            severity: 'critical',
          });
          continue;
        }

        // Compare fields
        this.compareFields(dbLine, chainRecord, result.mismatches);
      }

      // Check for records on chain but not in DB
      for (const chainRecord of chainRecords) {
        if (!dbMap.has(walletKey(chainRecord.walletAddress))) {
          result.mismatches.push({
            creditLineId: chainRecord.id,
            walletAddress: chainRecord.walletAddress,
            field: 'existence',
            dbValue: 'missing',
            chainValue: 'exists',
            severity: 'critical',
          });
        }
      }

      // Log results
      if (result.mismatches.length > 0) {
        console.error(
          `[ReconciliationService] Found ${result.mismatches.length} mismatches:`,
          sanitizeJsonForStellarDiagnostics(result.mismatches)
        );
      } else {
        console.log(
          `[ReconciliationService] Reconciliation complete. ${result.totalChecked} records checked, no mismatches found.`
        );
      }

    } catch (error) {
      const errorMessage = sanitizeStellarDiagnostic(error);
      result.errors.push(errorMessage);
      console.error('[ReconciliationService] Reconciliation failed:', errorMessage);
    }

    return result;
  }

  private compareFields(
    dbLine: { id: string; walletAddress: string; creditLimit: string; availableCredit: string; interestRateBps: number; status: string },
    chainRecord: OnChainCreditRecord,
    mismatches: ReconciliationMismatch[]
  ): void {
    const dbWalletKey = walletKey(dbLine.walletAddress);
    const chainWalletKey = walletKey(chainRecord.walletAddress);

    // Compare wallet address
    if (dbWalletKey !== chainWalletKey) {
      mismatches.push({
        creditLineId: dbLine.id,
        walletAddress: dbWalletKey,
        field: 'walletAddress',
        dbValue: dbWalletKey,
        chainValue: chainWalletKey,
        severity: 'critical',
      });
    } else if (dbLine.walletAddress !== chainRecord.walletAddress) {
      mismatches.push({
        creditLineId: dbLine.id,
        walletAddress: dbWalletKey,
        field: 'walletAddressFormatting',
        dbValue: sanitizeStellarDiagnostic(dbLine.walletAddress),
        chainValue: sanitizeStellarDiagnostic(chainRecord.walletAddress),
        severity: 'warning',
      });
    }

    // Compare credit limit
    if (dbLine.creditLimit !== chainRecord.creditLimit) {
      mismatches.push({
        creditLineId: dbLine.id,
        walletAddress: dbLine.walletAddress,
        field: 'creditLimit',
        dbValue: dbLine.creditLimit,
        chainValue: chainRecord.creditLimit,
        severity: 'critical',
      });
    }

    // Compare available credit
    if (dbLine.availableCredit !== chainRecord.availableCredit) {
      mismatches.push({
        creditLineId: dbLine.id,
        walletAddress: dbLine.walletAddress,
        field: 'availableCredit',
        dbValue: dbLine.availableCredit,
        chainValue: chainRecord.availableCredit,
        severity: 'warning',
      });
    }

    // Compare interest rate
    if (dbLine.interestRateBps !== chainRecord.interestRateBps) {
      mismatches.push({
        creditLineId: dbLine.id,
        walletAddress: dbLine.walletAddress,
        field: 'interestRateBps',
        dbValue: dbLine.interestRateBps,
        chainValue: chainRecord.interestRateBps,
        severity: 'warning',
      });
    }

    // Compare status
    if (dbLine.status !== chainRecord.status) {
      mismatches.push({
        creditLineId: dbLine.id,
        walletAddress: dbLine.walletAddress,
        field: 'status',
        dbValue: dbLine.status,
        chainValue: chainRecord.status,
        severity: 'critical',
      });
    }
  }
}

function walletKey(walletAddress: string): string {
  const trimmed = walletAddress.trim();

  if (trimmed.length === 0) {
    throw new Error('Borrower wallet address cannot be empty');
  }

  return trimmed;
}

function findDuplicateWallets(walletAddresses: string[]): string[] {
  const seen = new Set<string>();
  const duplicates = new Set<string>();

  for (const walletAddress of walletAddresses) {
    const key = walletKey(walletAddress);
    if (seen.has(key)) {
      duplicates.add(key);
    }
    seen.add(key);
  }

  return Array.from(duplicates);
}

function reconciliationDiagnostic(message: string): string {
  return sanitizeStellarDiagnostic(message);
}

async function fetchAllDbCreditLines(repository: CreditLineRepository): Promise<CreditLine[]> {
  const all: CreditLine[] = [];

  for (let offset = 0; ; offset += RECONCILIATION_DB_PAGE_SIZE) {
    const page = await repository.findAll(offset, RECONCILIATION_DB_PAGE_SIZE);
    all.push(...page);

    if (all.length > RECONCILIATION_MAX_DB_RECORDS) {
      throw new Error(
        `Reconciliation exceeded ${RECONCILIATION_MAX_DB_RECORDS} database credit lines; shard or raise the configured cap`,
      );
    }

    if (page.length < RECONCILIATION_DB_PAGE_SIZE) {
      return all;
    }
  }
}
