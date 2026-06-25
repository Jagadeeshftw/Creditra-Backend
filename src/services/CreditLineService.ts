import { type CreditLine, type CreateCreditLineRequest, type UpdateCreditLineRequest, CreditLineStatus } from '../models/CreditLine.js';
import type { CreditLineRepository, CursorPaginationResult } from '../repositories/interfaces/CreditLineRepository.js';

/**
 * Domain service for credit-line CRUD plus the `draw` / `repay` operations.
 *
 * Depends on the {@link CreditLineRepository} interface, not on a concrete
 * Postgres or in-memory implementation — the {@link Container} picks the
 * implementation at boot based on `DATABASE_URL` + `NODE_ENV`.
 *
 * Invariants enforced here, *before* the repository call:
 * - `walletAddress` is required on create
 * - `creditLimit` must parse to a positive decimal
 * - `interestRateBps` is clamped to the basis-points range `0..10000`
 * - Pagination `limit` is clamped to `1..100`; `offset` must be `≥ 0`
 *
 * Errors are thrown as plain {@link Error} with human-readable messages so
 * the route layer can map them to the `{ data, error }` response envelope.
 *
 * See `docs/ARCHITECTURE.md` §2 (request lifecycle) and `docs/API.md` for
 * the surfaces that call into this service.
 */
export class CreditLineService {
  constructor(private creditLineRepository: CreditLineRepository) {}

  /**
   * Create a new credit line for `walletAddress` with an explicit credit limit
   * and (optional) interest rate.
   *
   * @throws if `walletAddress` is empty, `creditLimit` ≤ 0, or
   * `interestRateBps` is outside `0..10000`.
   */
  async createCreditLine(request: CreateCreditLineRequest): Promise<CreditLine> {
    // Validate request
    if (!request.walletAddress) {
      throw new Error('Wallet address is required');
    }
    
    if (!request.creditLimit || parseFloat(request.creditLimit) <= 0) {
      throw new Error('Credit limit must be greater than 0');
    }

    if (request.interestRateBps < 0 || request.interestRateBps > 10000) {
      throw new Error('Interest rate must be between 0 and 10000 basis points');
    }

    return await this.creditLineRepository.create(request);
  }

  /** Fetch a single credit line by id, or `null` if not found. */
  async getCreditLine(id: string): Promise<CreditLine | null> {
    return await this.creditLineRepository.findById(id);
  }

  /** List every credit line owned by `walletAddress` (may be empty). */
  async getCreditLinesByWallet(walletAddress: string): Promise<CreditLine[]> {
    return await this.creditLineRepository.findByWalletAddress(walletAddress);
  }

  /**
   * Offset-pagination list of credit lines.
   *
   * @param offset zero-based row offset, must be `≥ 0`
   * @param limit page size, clamped to `1..100`
   */
  async getAllCreditLines(offset?: number, limit?: number): Promise<CreditLine[]> {
    if (offset !== undefined && offset < 0) {
      throw new Error('Offset cannot be negative');
    }
    if (limit !== undefined && limit <= 0) {
      throw new Error('Limit must be greater than 0');
    }
    if (limit !== undefined && limit > 100) {
      throw new Error('Limit cannot exceed 100');
    }
    return await this.creditLineRepository.findAll(offset, limit);
  }

  /**
   * Cursor-pagination list — preferred for large datasets because the cursor
   * is stable against concurrent inserts. The cursor is an opaque string
   * minted by the repository; clients pass `nextCursor` back unchanged.
   *
   * @see `docs/cursor-pagination.md`
   */
  async getAllCreditLinesWithCursor(cursor?: string, limit?: number): Promise<CursorPaginationResult> {
    if (limit !== undefined && limit <= 0) {
      throw new Error('Limit must be greater than 0');
    }
    if (limit !== undefined && limit > 100) {
      throw new Error('Limit cannot exceed 100');
    }
    return await this.creditLineRepository.findAllWithCursor(cursor, limit);
  }

  /**
   * Patch credit-line fields (`creditLimit`, `interestRateBps`, `status`).
   *
   * Validates limit/rate bounds before delegating to the repository. Returns
   * `null` if `id` does not exist — the route layer maps that to `404`.
   */
  async updateCreditLine(id: string, request: UpdateCreditLineRequest): Promise<CreditLine | null> {
    // Validate update request
    if (request.creditLimit && parseFloat(request.creditLimit) <= 0) {
      throw new Error('Credit limit must be greater than 0');
    }

    if (request.interestRateBps !== undefined && 
        (request.interestRateBps < 0 || request.interestRateBps > 10000)) {
      throw new Error('Interest rate must be between 0 and 10000 basis points');
    }

    return await this.creditLineRepository.update(id, request);
  }

  /** Hard-delete a credit line. Returns `false` if `id` did not exist. */
  async deleteCreditLine(id: string): Promise<boolean> {
    return await this.creditLineRepository.delete(id);
  }

  /** Total credit-line row count — used for paging headers. */
  async getCreditLineCount(): Promise<number> {
    return await this.creditLineRepository.count();
  }

  /**
   * Deduct `amount` from the line's available credit.
   *
   * Enforced rules:
   * - line must exist (otherwise throws "Credit line not found")
   * - `borrowerId` (wallet address) must match `line.walletAddress` (otherwise throws "Unauthorized")
   * - line `status` must be {@link CreditLineStatus.ACTIVE}
   * - `utilized + amount` must not exceed `creditLimit`
   *
   * On success the persisted `utilized` field is incremented atomically by
   * the repository. The on-chain transaction is submitted separately by the
   * caller's wallet or integration; confirmation flows back through the indexer.
   */
  async draw(id: string, borrowerId: string, amount: string): Promise<CreditLine> {
    const line = await this.creditLineRepository.findById(id);
    if (!line) {
      throw new Error('Credit line not found');
    }

    if (line.walletAddress !== borrowerId) {
      throw new Error('Unauthorized');
    }

    if (line.status !== CreditLineStatus.ACTIVE) {
      throw new Error('Credit line is not active');
    }

    const amountNum = parseFloat(amount);
    const limitNum = parseFloat(line.creditLimit);
    const utilizedNum = parseFloat(line.utilized || '0');

    if (utilizedNum + amountNum > limitNum) {
      throw new Error('Credit limit exceeded');
    }

    return await this.creditLineRepository.update(id, {
      utilized: (utilizedNum + amountNum).toString(),
    }) as CreditLine;
  }

  /**
   * Restore `amount` of available credit by reducing the line's `utilized`
   * balance. The utilized amount is floored at `0` so a stray overpayment
   * can never produce negative utilization on the persisted row.
   *
   * Like {@link draw}, this method only manipulates the off-chain mirror of
   * state. The on-chain repay transaction is broadcast separately and
   * confirmed by the indexer.
   */
  async repay(id: string, _walletAddress: string, amount: string): Promise<CreditLine> {
    const line = await this.creditLineRepository.findById(id);
    if (!line) {
      throw new Error('Credit line not found');
    }

    const amountNum = parseFloat(amount);
    const utilizedNum = parseFloat(line.utilized || '0');

    return await this.creditLineRepository.update(id, {
      utilized: Math.max(0, utilizedNum - amountNum).toString(),
    }) as CreditLine;
  }
}
