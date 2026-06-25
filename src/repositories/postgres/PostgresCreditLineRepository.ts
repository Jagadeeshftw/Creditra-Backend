import type { CreditLine, CreateCreditLineRequest, UpdateCreditLineRequest, CreditLineStatus } from '../../models/CreditLine.js';
import type { CreditLineRepository, CursorPaginationResult } from '../interfaces/CreditLineRepository.js';
import type { DbClient } from '../../db/client.js';

interface CreditLineRow {
  id: string;
  credit_limit: string;
  currency: string;
  status: string;
  interest_rate_bps: number;
  created_at: Date;
  updated_at: Date;
  wallet_address: string;
}

export class PostgresCreditLineRepository implements CreditLineRepository {
  constructor(private client: DbClient) {}

  async create(request: CreateCreditLineRequest): Promise<CreditLine> {
    // First, ensure borrower exists or create it
    const borrowerId = await this.ensureBorrower(request.walletAddress);

    const query = `
      INSERT INTO credit_lines (borrower_id, credit_limit, currency, status, interest_rate_bps)
      VALUES ($1, $2, $3, $4, $5)
      RETURNING id, borrower_id, credit_limit, currency, status, interest_rate_bps, created_at, updated_at
    `;

    const values = [
      borrowerId,
      request.creditLimit,
      'USDC', // Default currency - could be made configurable
      'active', // Default status
      request.interestRateBps
    ];

    const result = await this.client.query(query, values);
    const row = result.rows[0] as {
      id: string;
      borrower_id: string;
      credit_limit: string;
      currency: string;
      status: string;
      interest_rate_bps: number;
      created_at: Date;
      updated_at: Date;
    };

    // Get wallet address for the response
    const walletAddress = await this.getWalletAddress(borrowerId);

    return {
      id: row.id,
      walletAddress,
      creditLimit: row.credit_limit,
      availableCredit: row.credit_limit, // Initially full credit available
      utilized: '0',
      interestRateBps: row.interest_rate_bps,
      status: row.status as CreditLineStatus,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    };
  }

  async findById(id: string): Promise<CreditLine | null> {
    const query = `
      SELECT 
        cl.id,
        cl.credit_limit,
        cl.currency,
        cl.status,
        cl.interest_rate_bps,
        cl.created_at,
        cl.updated_at,
        b.wallet_address
      FROM credit_lines cl
      JOIN borrowers b ON cl.borrower_id = b.id
      WHERE cl.id = $1
    `;

    const result = await this.client.query(query, [id]);
    
    if (result.rows.length === 0) {
      return null;
    }

    const row = result.rows[0] as CreditLineRow;

    // Calculate available credit by subtracting total draws
    const availableCredit = await this.calculateAvailableCredit(id, row.credit_limit);

    return this.toCreditLine(row, availableCredit);
  }

  async findByWalletAddress(walletAddress: string): Promise<CreditLine[]> {
    const query = `
      SELECT 
        cl.id,
        cl.credit_limit,
        cl.currency,
        cl.status,
        cl.interest_rate_bps,
        cl.created_at,
        cl.updated_at,
        b.wallet_address
      FROM credit_lines cl
      JOIN borrowers b ON cl.borrower_id = b.id
      WHERE b.wallet_address = $1
      ORDER BY cl.created_at DESC
    `;

    const result = await this.client.query(query, [walletAddress]);
    const creditLines: CreditLine[] = [];

    for (const row of result.rows as CreditLineRow[]) {
      const availableCredit = await this.calculateAvailableCredit(row.id, row.credit_limit);
      creditLines.push(this.toCreditLine(row, availableCredit));
    }

    return creditLines;
  }

  async findAll(offset = 0, limit = 100): Promise<CreditLine[]> {
    const query = `
      SELECT 
        cl.id,
        cl.credit_limit,
        cl.currency,
        cl.status,
        cl.interest_rate_bps,
        cl.created_at,
        cl.updated_at,
        b.wallet_address
      FROM credit_lines cl
      JOIN borrowers b ON cl.borrower_id = b.id
      ORDER BY cl.created_at DESC
      LIMIT $1 OFFSET $2
    `;

    const result = await this.client.query(query, [limit, offset]);
    const creditLines: CreditLine[] = [];

    for (const row of result.rows as CreditLineRow[]) {
      const availableCredit = await this.calculateAvailableCredit(row.id, row.credit_limit);
      creditLines.push(this.toCreditLine(row, availableCredit));
    }

    return creditLines;
  }

  async findAllWithCursor(cursor?: string, limit = 100): Promise<CursorPaginationResult> {
    let cursorTime: Date | null = null;
    let cursorId: string | null = null;

    if (cursor) {
      try {
        const decodedCursor = Buffer.from(cursor, 'base64').toString('utf-8');
        const [timestamp, id] = decodedCursor.split('|');
        const parsedTime = new Date(Number(timestamp));
        if (!Number.isNaN(parsedTime.getTime()) && id) {
          cursorTime = parsedTime;
          cursorId = id;
        }
      } catch {
        cursorTime = null;
        cursorId = null;
      }
    }

    const whereClause = cursorTime && cursorId
      ? 'WHERE (cl.created_at > $2 OR (cl.created_at = $2 AND cl.id > $3))'
      : '';
    const values = cursorTime && cursorId
      ? [limit + 1, cursorTime, cursorId]
      : [limit + 1];

    const query = `
      SELECT
        cl.id,
        cl.credit_limit,
        cl.currency,
        cl.status,
        cl.interest_rate_bps,
        cl.created_at,
        cl.updated_at,
        b.wallet_address
      FROM credit_lines cl
      JOIN borrowers b ON cl.borrower_id = b.id
      ${whereClause}
      ORDER BY cl.created_at ASC, cl.id ASC
      LIMIT $1
    `;

    const result = await this.client.query(query, values);
    const rows = result.rows as CreditLineRow[];
    const creditLines: CreditLine[] = [];

    for (const row of rows) {
      const availableCredit = await this.calculateAvailableCredit(row.id, row.credit_limit);
      creditLines.push(this.toCreditLine(row, availableCredit));
    }

    const hasMore = creditLines.length > limit;
    const items = creditLines.slice(0, limit);
    const lastItem = items[items.length - 1];

    return {
      items,
      hasMore,
      nextCursor: hasMore && lastItem
        ? Buffer.from(`${lastItem.createdAt.getTime()}|${lastItem.id}`, 'utf-8').toString('base64')
        : null,
    };
  }

  async update(id: string, request: UpdateCreditLineRequest): Promise<CreditLine | null> {
    const setParts: string[] = [];
    const values: unknown[] = [];
    let paramIndex = 1;

    if (request.creditLimit !== undefined) {
      setParts.push(`credit_limit = $${paramIndex++}`);
      values.push(request.creditLimit);
    }

    if (request.interestRateBps !== undefined) {
      setParts.push(`interest_rate_bps = $${paramIndex++}`);
      values.push(request.interestRateBps);
    }

    if (request.status !== undefined) {
      setParts.push(`status = $${paramIndex++}`);
      values.push(request.status);
    }

    if (setParts.length === 0) {
      // No updates requested, return current record
      return this.findById(id);
    }

    setParts.push(`updated_at = now()`);
    values.push(id); // For WHERE clause

    const query = `
      UPDATE credit_lines 
      SET ${setParts.join(', ')}
      WHERE id = $${paramIndex}
      RETURNING id
    `;

    const result = await this.client.query(query, values);
    
    if (result.rows.length === 0) {
      return null;
    }

    // Return updated record
    return this.findById(id);
  }

  async delete(id: string): Promise<boolean> {
    const query = 'DELETE FROM credit_lines WHERE id = $1';
    const result = await this.client.query(query, [id]);
    return (result as unknown as { rowCount: number }).rowCount > 0;
  }

  async exists(id: string): Promise<boolean> {
    const query = 'SELECT 1 FROM credit_lines WHERE id = $1';
    const result = await this.client.query(query, [id]);
    return result.rows.length > 0;
  }

  async count(): Promise<number> {
    const query = 'SELECT COUNT(*) as count FROM credit_lines';
    const result = await this.client.query(query);
    const row = result.rows[0] as { count: string };
    return parseInt(row.count, 10);
  }

  /**
   * Ensure borrower exists for the given wallet address, create if not exists.
   * Returns the borrower ID.
   */
  private async ensureBorrower(walletAddress: string): Promise<string> {
    // Try to find existing borrower
    const findQuery = 'SELECT id FROM borrowers WHERE wallet_address = $1';
    const findResult = await this.client.query(findQuery, [walletAddress]);
    
    if (findResult.rows.length > 0) {
      const row = findResult.rows[0] as { id: string };
      return row.id;
    }

    // Create new borrower
    const createQuery = `
      INSERT INTO borrowers (wallet_address)
      VALUES ($1)
      RETURNING id
    `;
    const createResult = await this.client.query(createQuery, [walletAddress]);
    const row = createResult.rows[0] as { id: string };
    return row.id;
  }

  /**
   * Get wallet address for a borrower ID.
   */
  private async getWalletAddress(borrowerId: string): Promise<string> {
    const query = 'SELECT wallet_address FROM borrowers WHERE id = $1';
    const result = await this.client.query(query, [borrowerId]);
    
    if (result.rows.length === 0) {
      throw new Error(`Borrower not found: ${borrowerId}`);
    }

    const row = result.rows[0] as { wallet_address: string };
    return row.wallet_address;
  }

  /**
   * Calculate available credit by subtracting total draws from credit limit.
   * For now, returns the full credit limit since we don't have transaction tracking yet.
   */
  private async calculateAvailableCredit(_creditLineId: string, creditLimit: string): Promise<string> {
    // TODO: When transaction repository is implemented, calculate:
    // creditLimit - SUM(transactions where type = 'draw' and credit_line_id = creditLineId)
    
    // For now, return full credit limit
    return creditLimit;
  }

  private calculateUtilized(creditLimit: string, availableCredit: string): string {
    const utilized = Number.parseFloat(creditLimit) - Number.parseFloat(availableCredit);
    return Number.isFinite(utilized) ? Math.max(0, utilized).toString() : '0';
  }

  private toCreditLine(row: CreditLineRow, availableCredit: string): CreditLine {
    return {
      id: row.id,
      walletAddress: row.wallet_address,
      creditLimit: row.credit_limit,
      availableCredit,
      utilized: this.calculateUtilized(row.credit_limit, availableCredit),
      interestRateBps: row.interest_rate_bps,
      status: row.status as CreditLineStatus,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    };
  }
}
