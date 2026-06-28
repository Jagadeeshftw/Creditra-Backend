import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { DbClient } from '../../../db/client.js';
import { PostgresCreditLineRepository } from '../PostgresCreditLineRepository.js';
import { CreditLineStatus } from '../../../models/CreditLine.js';

function createMockClient(overrides: Partial<DbClient> = {}): DbClient {
  return {
    query: vi.fn().mockResolvedValue({ rows: [] }),
    end: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

describe('PostgresCreditLineRepository', () => {
  let repository: PostgresCreditLineRepository;
  let mockClient: DbClient;

  beforeEach(() => {
    mockClient = createMockClient();
    repository = new PostgresCreditLineRepository(mockClient);
  });

  describe('create', () => {
    it('should create a new credit line with new borrower', async () => {
      const mockBorrowerId = 'borrower-123';
      const mockCreditLineId = 'credit-line-456';
      const now = new Date();

      // Mock borrower lookup (not found)
      vi.mocked(mockClient.query)
        .mockResolvedValueOnce({ rows: [] })
        // Mock borrower creation
        .mockResolvedValueOnce({ rows: [{ id: mockBorrowerId }] })
        // Mock credit line creation
        .mockResolvedValueOnce({
          rows: [{
            id: mockCreditLineId,
            borrower_id: mockBorrowerId,
            credit_limit: '10000.00',
            currency: 'USDC',
            status: 'active',
            interest_rate_bps: 500,
            version: 1,
            created_at: now,
            updated_at: now
          }]
        })
        // Mock wallet address lookup
        .mockResolvedValueOnce({ rows: [{ wallet_address: 'GTEST123' }] });

      const request = {
        walletAddress: 'GTEST123',
        creditLimit: '10000.00',
        interestRateBps: 500
      };

      const result = await repository.create(request);

      expect(result).toEqual({
        id: mockCreditLineId,
        walletAddress: 'GTEST123',
        creditLimit: '10000.00',
        availableCredit: '10000.00',
        utilized: '0',
        interestRateBps: 500,
        status: CreditLineStatus.ACTIVE,
        version: 1,
        createdAt: now,
        updatedAt: now
      });

      expect(mockClient.query).toHaveBeenCalledTimes(4);
    });

    it('should create a credit line with existing borrower', async () => {
      const mockBorrowerId = 'borrower-123';
      const mockCreditLineId = 'credit-line-456';
      const now = new Date();

      // Mock borrower lookup (found)
      vi.mocked(mockClient.query)
        .mockResolvedValueOnce({ rows: [{ id: mockBorrowerId }] })
        // Mock credit line creation
        .mockResolvedValueOnce({
          rows: [{
            id: mockCreditLineId,
            borrower_id: mockBorrowerId,
            credit_limit: '5000.00',
            currency: 'USDC',
            status: 'active',
            interest_rate_bps: 750,
            version: 1,
            created_at: now,
            updated_at: now
          }]
        })
        // Mock wallet address lookup
        .mockResolvedValueOnce({ rows: [{ wallet_address: 'GTEST456' }] });

      const request = {
        walletAddress: 'GTEST456',
        creditLimit: '5000.00',
        interestRateBps: 750
      };

      const result = await repository.create(request);

      expect(result.interestRateBps).toBe(750);
      expect(mockClient.query).toHaveBeenCalledTimes(3); // No borrower creation
    });
  });

  describe('findById', () => {
    it('should return credit line when found', async () => {
      const mockId = 'credit-line-123';
      const now = new Date();

      vi.mocked(mockClient.query)
        .mockResolvedValueOnce({
          rows: [{
            id: mockId,
            credit_limit: '15000.00',
            currency: 'USDC',
            status: 'active',
            interest_rate_bps: 600,
            version: 1,
            created_at: now,
            updated_at: now,
            wallet_address: 'GTEST789'
          }]
        });

      const result = await repository.findById(mockId);

      expect(result).toEqual({
        id: mockId,
        walletAddress: 'GTEST789',
        creditLimit: '15000.00',
        availableCredit: '15000.00', // Full credit available initially
        utilized: '0',
        interestRateBps: 600,
        status: CreditLineStatus.ACTIVE,
        version: 1,
        createdAt: now,
        updatedAt: now
      });
    });

    it('should return null when not found', async () => {
      vi.mocked(mockClient.query).mockResolvedValueOnce({ rows: [] });

      const result = await repository.findById('nonexistent');

      expect(result).toBeNull();
    });
  });

  describe('findByWalletAddress', () => {
    it('should return credit lines for wallet address', async () => {
      const walletAddress = 'GTEST123';
      const now = new Date();

      vi.mocked(mockClient.query)
        .mockResolvedValueOnce({
          rows: [
            {
              id: 'credit-line-1',
              credit_limit: '10000.00',
              currency: 'USDC',
              status: 'active',
              interest_rate_bps: 500,
              created_at: now,
              updated_at: now,
              wallet_address: walletAddress
            },
            {
              id: 'credit-line-2',
              credit_limit: '5000.00',
              currency: 'USDC',
              status: 'suspended',
              interest_rate_bps: 750,
              created_at: now,
              updated_at: now,
              wallet_address: walletAddress
            }
          ]
        });

      const result = await repository.findByWalletAddress(walletAddress);

      expect(result).toHaveLength(2);
      expect(result[0].interestRateBps).toBe(500);
      expect(result[1].interestRateBps).toBe(750);
      expect(result[1].status).toBe(CreditLineStatus.SUSPENDED);
    });

    it('should return empty array when no credit lines found', async () => {
      vi.mocked(mockClient.query).mockResolvedValueOnce({ rows: [] });

      const result = await repository.findByWalletAddress('GNONEXISTENT');

      expect(result).toEqual([]);
    });
  });

  describe('findAll', () => {
    it('should return paginated credit lines', async () => {
      const now = new Date();

      vi.mocked(mockClient.query)
        .mockResolvedValueOnce({
          rows: [
            {
              id: 'credit-line-1',
              credit_limit: '10000.00',
              currency: 'USDC',
              status: 'active',
              interest_rate_bps: 500,
              created_at: now,
              updated_at: now,
              wallet_address: 'GTEST1'
            }
          ]
        });

      const result = await repository.findAll(0, 10);

      expect(result).toHaveLength(1);
      expect(mockClient.query).toHaveBeenCalledWith(
        expect.stringContaining('LIMIT $1 OFFSET $2'),
        [10, 0]
      );
    });
  });

  describe('update', () => {
    it('should update credit line fields', async () => {
      const creditLineId = 'credit-line-123';
      const now = new Date();

      // Mock update query
      vi.mocked(mockClient.query)
        .mockResolvedValueOnce({ rows: [{ id: creditLineId }] })
        // Mock findById for return value
        .mockResolvedValueOnce({
          rows: [{
            id: creditLineId,
            credit_limit: '20000.00',
            currency: 'USDC',
            status: 'active',
            interest_rate_bps: 400,
            created_at: now,
            updated_at: now,
            wallet_address: 'GTEST123'
          }]
        });

      const updateRequest = {
        creditLimit: '20000.00',
        interestRateBps: 400
      };

      const result = await repository.update(creditLineId, updateRequest);

      expect(result?.creditLimit).toBe('20000.00');
      expect(result?.interestRateBps).toBe(400);
      
      // Verify update query was called with correct parameters
      expect(mockClient.query).toHaveBeenCalledWith(
        expect.stringContaining('UPDATE credit_lines'),
        ['20000.00', 400, creditLineId]
      );
    });

    it('should return null when credit line not found', async () => {
      vi.mocked(mockClient.query).mockResolvedValueOnce({ rows: [] });

      const result = await repository.update('nonexistent', { status: CreditLineStatus.CLOSED });

      expect(result).toBeNull();
    });

    it('should return current record when no updates provided', async () => {
      const creditLineId = 'credit-line-123';
      const now = new Date();

      // Mock findById call
      vi.mocked(mockClient.query)
        .mockResolvedValueOnce({
          rows: [{
            id: creditLineId,
            credit_limit: '10000.00',
            currency: 'USDC',
            status: 'active',
            interest_rate_bps: 500,
            created_at: now,
            updated_at: now,
            wallet_address: 'GTEST123'
          }]
        });

      const result = await repository.update(creditLineId, {});

      expect(result?.id).toBe(creditLineId);
      expect(mockClient.query).toHaveBeenCalledTimes(1); // Only findById, no update
    });
  });

  describe('delete', () => {
    it('should delete credit line and return true', async () => {
      const mockResult = { rowCount: 1 };
      vi.mocked(mockClient.query).mockResolvedValueOnce(mockResult as unknown as { rows: unknown[] });

      const result = await repository.delete('credit-line-123');

      expect(result).toBe(true);
      expect(mockClient.query).toHaveBeenCalledWith(
        'DELETE FROM credit_lines WHERE id = $1',
        ['credit-line-123']
      );
    });

    it('should return false when credit line not found', async () => {
      const mockResult = { rowCount: 0 };
      vi.mocked(mockClient.query).mockResolvedValueOnce(mockResult as unknown as { rows: unknown[] });

      const result = await repository.delete('nonexistent');

      expect(result).toBe(false);
    });
  });

  describe('exists', () => {
    it('should return true when credit line exists', async () => {
      vi.mocked(mockClient.query).mockResolvedValueOnce({ rows: [{ '?column?': 1 }] });

      const result = await repository.exists('credit-line-123');

      expect(result).toBe(true);
    });

    it('should return false when credit line does not exist', async () => {
      vi.mocked(mockClient.query).mockResolvedValueOnce({ rows: [] });

      const result = await repository.exists('nonexistent');

      expect(result).toBe(false);
    });
  });

  describe('count', () => {
    it('should return total count of credit lines', async () => {
      vi.mocked(mockClient.query).mockResolvedValueOnce({ rows: [{ count: '42' }] });

      const result = await repository.count();

      expect(result).toBe(42);
      expect(mockClient.query).toHaveBeenCalledWith('SELECT COUNT(*) as count FROM credit_lines');
    });
  });

  describe('ensureBorrower', () => {
    it('should handle borrower creation error gracefully', async () => {
      // Mock borrower lookup (not found)
      vi.mocked(mockClient.query)
        .mockResolvedValueOnce({ rows: [] })
        // Mock borrower creation failure
        .mockRejectedValueOnce(new Error('Database error'));

      const request = {
        walletAddress: 'GTEST123',
        creditLimit: '10000.00',
        interestRateBps: 500
      };

      await expect(repository.create(request)).rejects.toThrow('Database error');
    });
  });

  describe('getWalletAddress', () => {
    it('should throw error when borrower not found', async () => {
      // Mock successful borrower lookup
      vi.mocked(mockClient.query)
        .mockResolvedValueOnce({ rows: [{ id: 'borrower-123' }] })
        // Mock credit line creation
        .mockResolvedValueOnce({
          rows: [{
            id: 'credit-line-456',
            borrower_id: 'borrower-123',
            credit_limit: '10000.00',
            currency: 'USDC',
            status: 'active',
            interest_rate_bps: 500,
            created_at: new Date(),
            updated_at: new Date()
          }]
        })
        // Mock wallet address lookup failure
        .mockResolvedValueOnce({ rows: [] });

      const request = {
        walletAddress: 'GTEST123',
        creditLimit: '10000.00',
        interestRateBps: 500
      };

      await expect(repository.create(request)).rejects.toThrow('Borrower not found: borrower-123');
    });
  });
});
