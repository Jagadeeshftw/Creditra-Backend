import{ type CreditLine, type CreateCreditLineRequest, type UpdateCreditLineRequest, CreditLineStatus } from '../../models/CreditLine.js';
import type{ CreditLineRepository, CursorPaginationResult } from '../interfaces/CreditLineRepository.js';
import { VersionConflictError } from '../../services/creditService.js';
import { randomUUID } from 'crypto';

export class InMemoryCreditLineRepository implements CreditLineRepository {
  private creditLines: Map<string, CreditLine> = new Map();

  private sortByNewest(creditLines: CreditLine[]): CreditLine[] {
    return creditLines.sort((a, b) => {
      const tsDiff = b.createdAt.getTime() - a.createdAt.getTime();
      if (tsDiff !== 0) return tsDiff;
      return a.id.localeCompare(b.id);
    });
  }

  async create(request: CreateCreditLineRequest): Promise<CreditLine> {
    const id = randomUUID();
    const now = new Date();
    
    const creditLine: CreditLine = {
      id,
      walletAddress: request.walletAddress,
      creditLimit: request.creditLimit,
      availableCredit: request.creditLimit, // Initially full credit available
      utilized: '0',
      interestRateBps: request.interestRateBps,
      status: CreditLineStatus.ACTIVE,
      version: 1,
      createdAt: now,
      updatedAt: now
    };

    this.creditLines.set(id, creditLine);
    return creditLine;
  }

  async findById(id: string): Promise<CreditLine | null> {
    return this.creditLines.get(id) || null;
  }

  async findByWalletAddress(walletAddress: string): Promise<CreditLine[]> {
    const filtered = Array.from(this.creditLines.values()).filter(cl => cl.walletAddress === walletAddress);
    return this.sortByNewest(filtered);
  }

  async findAll(offset = 0, limit = 100): Promise<CreditLine[]> {
    const all = this.sortByNewest(Array.from(this.creditLines.values()));
    return all.slice(offset, offset + limit);
  }

  async findAllWithCursor(cursor?: string, limit = 100): Promise<CursorPaginationResult> {
    // Sort by createdAt and id for stable ordering
    const all = Array.from(this.creditLines.values())
      .sort((a, b) => {
        const timeCompare = a.createdAt.getTime() - b.createdAt.getTime();
        return timeCompare !== 0 ? timeCompare : a.id.localeCompare(b.id);
      });

    let startIndex = 0;

    // If cursor is provided, find the starting position
    if (cursor) {
      try {
        const decodedCursor = Buffer.from(cursor, 'base64').toString('utf-8');
        const [cursorTime, cursorId] = decodedCursor.split('|');
        
        startIndex = all.findIndex(cl => {
          const clTime = cl.createdAt.getTime().toString();
          return clTime === cursorTime && cl.id === cursorId;
        });

        // If cursor not found or invalid, start from beginning
        if (startIndex === -1) {
          startIndex = 0;
        } else {
          // Start from the next item after the cursor
          startIndex += 1;
        }
      } catch {
        // Invalid cursor format, start from beginning
        startIndex = 0;
      }
    }

    const items = all.slice(startIndex, startIndex + limit);
    const hasMore = startIndex + limit < all.length;

    let nextCursor: string | null = null;
    if (hasMore && items.length > 0) {
      const lastItem = items[items.length - 1];
      const cursorData = `${lastItem.createdAt.getTime()}|${lastItem.id}`;
      nextCursor = Buffer.from(cursorData, 'utf-8').toString('base64');
    }

    return {
      items,
      nextCursor,
      hasMore
    };
  }

  async update(id: string, request: UpdateCreditLineRequest): Promise<CreditLine | null> {
    const existing = this.creditLines.get(id);
    if (!existing) {
      return null;
    }

    const currentVersion = existing.version ?? 1;

    // Optimistic locking: when the caller supplies the version it read,
    // reject the write if another update advanced it in the meantime.
    if (request.expectedVersion !== undefined && request.expectedVersion !== currentVersion) {
      throw new VersionConflictError(id, request.expectedVersion, currentVersion);
    }

    const { expectedVersion: _expectedVersion, ...patch } = request;

    const updated: CreditLine = {
      ...existing,
      ...patch,
      version: currentVersion + 1,
      updatedAt: new Date()
    };

    // Keep availableCredit in sync if utilized changes
    if (request.utilized !== undefined) {
      const limit = parseFloat(updated.creditLimit);
      const utilized = parseFloat(request.utilized);
      updated.availableCredit = (limit - utilized).toString();
    }
    // If credit limit changed, adjust available credit proportionally
    if (request.creditLimit && request.creditLimit !== existing.creditLimit) {
      const oldLimit = parseFloat(existing.creditLimit);
      const newLimit = parseFloat(request.creditLimit);
      const oldAvailable = parseFloat(existing.availableCredit);
      
      // Maintain the same ratio of available credit
      const ratio = oldLimit > 0 ? oldAvailable / oldLimit : 1;
      updated.availableCredit = (newLimit * ratio).toString();
    }

    this.creditLines.set(id, updated);
    return updated;
  }

  async delete(id: string): Promise<boolean> {
    return this.creditLines.delete(id);
  }

  async exists(id: string): Promise<boolean> {
    return this.creditLines.has(id);
  }

  async count(): Promise<number> {
    return this.creditLines.size;
  }

  // Helper method for testing
  clear(): void {
    this.creditLines.clear();
  }
}