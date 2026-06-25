import { describe, it, expect, beforeEach } from 'vitest';
import { InMemoryTransactionRepository } from '../InMemoryTransactionRepository.js';
import { TransactionType, TransactionStatus } from '../../../models/Transaction.js';

describe('InMemoryTransactionRepository', () => {
  let repository: InMemoryTransactionRepository;

  beforeEach(() => {
    repository = new InMemoryTransactionRepository();
  });

  describe('create', () => {
    it('should create a new transaction', async () => {
      const request = {
        creditLineId: 'cl-123',
        amount: '100.00',
        type: TransactionType.BORROW,
        blockchainTxHash: 'tx-hash-123'
      };

      const transaction = await repository.create(request);

      expect(transaction.id).toBeDefined();
      expect(transaction.creditLineId).toBe(request.creditLineId);
      expect(transaction.amount).toBe(request.amount);
      expect(transaction.type).toBe(request.type);
      expect(transaction.status).toBe(TransactionStatus.PENDING);
      expect(transaction.blockchainTxHash).toBe(request.blockchainTxHash);
      expect(transaction.createdAt).toBeInstanceOf(Date);
      expect(transaction.processedAt).toBeUndefined();
    });

    it('should create transaction without blockchain hash', async () => {
      const request = {
        creditLineId: 'cl-123',
        amount: '100.00',
        type: TransactionType.REPAY
      };

      const transaction = await repository.create(request);

      expect(transaction.blockchainTxHash).toBeUndefined();
    });
  });

  describe('findById', () => {
    it('should return transaction when found', async () => {
      const created = await repository.create({
        creditLineId: 'cl-123',
        amount: '100.00',
        type: TransactionType.BORROW
      });

      const found = await repository.findById(created.id);

      expect(found).toEqual(created);
    });

    it('should return null when not found', async () => {
      const found = await repository.findById('nonexistent');
      expect(found).toBeNull();
    });
  });

  describe('findByCreditLineId', () => {
    it('should return transactions for credit line sorted by date', async () => {
      const creditLineId = 'cl-123';

      const tx1 = await repository.create({
        creditLineId,
        amount: '100.00',
        type: TransactionType.BORROW
      });

      const tx2 = await repository.create({
        creditLineId,
        amount: '50.00',
        type: TransactionType.REPAY
      });
      const olderCreatedAt = new Date('2026-01-01T00:00:00.000Z');
      const newerCreatedAt = new Date('2026-01-01T00:00:01.000Z');
      const olderTransaction = { ...tx1, createdAt: olderCreatedAt };
      const newerTransaction = { ...tx2, createdAt: newerCreatedAt };

      repository['transactions'].set(tx1.id, olderTransaction);
      repository['transactions'].set(tx2.id, newerTransaction);

      await repository.create({
        creditLineId: 'other-cl',
        amount: '200.00',
        type: TransactionType.BORROW
      });

      const transactions = await repository.findByCreditLineId(creditLineId);

      expect(transactions).toHaveLength(2);
      expect(transactions[0]).toEqual(newerTransaction);
      expect(transactions[1]).toEqual(olderTransaction);
    });

    it('should support pagination', async () => {
      const creditLineId = 'cl-123';

      // Create 5 transactions
      for (let i = 0; i < 5; i++) {
        await repository.create({
          creditLineId,
          amount: `${100 + i}.00`,
          type: TransactionType.BORROW
        });
        await new Promise(resolve => setTimeout(resolve, 1));
      }

      const paginated = await repository.findByCreditLineId(creditLineId, 2, 2);
      expect(paginated).toHaveLength(2);
    });

    it('should return empty array when no transactions found', async () => {
      const transactions = await repository.findByCreditLineId('nonexistent');
      expect(transactions).toEqual([]);
    });
  });

  describe('findByWalletAddress', () => {
    it('should return transactions for wallet address', async () => {
      const walletAddress = 'GBAHQCUPC7G2B4D2F2I2K2M2O2Q2S2U2W2Y2A2C2E2G2I2K2M2O2Q2S1';

      const tx1 = await repository.create({
        creditLineId: 'cl-123',
        amount: '100.00',
        type: TransactionType.BORROW
      });
      // Manually set wallet address since it's set by service layer
      tx1.walletAddress = walletAddress;
      repository['transactions'].set(tx1.id, tx1);

      const tx2 = await repository.create({
        creditLineId: 'cl-456',
        amount: '50.00',
        type: TransactionType.REPAY
      });
      tx2.walletAddress = walletAddress;
      repository['transactions'].set(tx2.id, tx2);

      const tx3 = await repository.create({
        creditLineId: 'cl-789',
        amount: '200.00',
        type: TransactionType.BORROW
      });
      tx3.walletAddress = 'other-wallet';
      repository['transactions'].set(tx3.id, tx3);

      const transactions = await repository.findByWalletAddress(walletAddress);

      expect(transactions).toHaveLength(2);
      expect(transactions.every(tx => tx.walletAddress === walletAddress)).toBe(true);
    });

    it('should support pagination', async () => {
      const walletAddress = 'GBAHQCUPC7G2B4D2F2I2K2M2O2Q2S2U2W2Y2A2C2E2G2I2K2M2O2Q2S1';

      // Create 3 transactions
      for (let i = 0; i < 3; i++) {
        const tx = await repository.create({
          creditLineId: `cl-${i}`,
          amount: `${100 + i}.00`,
          type: TransactionType.BORROW
        });
        tx.walletAddress = walletAddress;
        repository['transactions'].set(tx.id, tx);
      }

      const paginated = await repository.findByWalletAddress(walletAddress, 1, 1);
      expect(paginated).toHaveLength(1);
    });
  });

  describe('updateStatus', () => {
    it('should update transaction status successfully', async () => {
      const created = await repository.create({
        creditLineId: 'cl-123',
        amount: '100.00',
        type: TransactionType.BORROW
      });

      const processedAt = new Date();
      const updated = await repository.updateStatus(created.id, TransactionStatus.CONFIRMED, processedAt);

      expect(updated).toBeDefined();
      expect(updated!.status).toBe(TransactionStatus.CONFIRMED);
      expect(updated!.processedAt).toEqual(processedAt);
    });

    it('should update status without processedAt', async () => {
      const created = await repository.create({
        creditLineId: 'cl-123',
        amount: '100.00',
        type: TransactionType.BORROW
      });

      const updated = await repository.updateStatus(created.id, TransactionStatus.FAILED);

      expect(updated!.status).toBe(TransactionStatus.FAILED);
      expect(updated!.processedAt).toBeInstanceOf(Date);
    });

    it('should return null when transaction not found', async () => {
      const updated = await repository.updateStatus('nonexistent', TransactionStatus.CONFIRMED);
      expect(updated).toBeNull();
    });
  });

  describe('findAll', () => {
    it('should return all transactions sorted by date', async () => {
      // Create 3 transactions
      const transactions = [];
      for (let i = 0; i < 3; i++) {
        const tx = await repository.create({
          creditLineId: `cl-${i}`,
          amount: `${100 + i}.00`,
          type: TransactionType.BORROW
        });
        transactions.push(tx);
        await new Promise(resolve => setTimeout(resolve, 1));
      }

      const all = await repository.findAll();
      expect(all).toHaveLength(3);
      // Should be sorted by creation date descending
      expect(all[0].createdAt.getTime()).toBeGreaterThanOrEqual(all[1].createdAt.getTime());
    });

    it('should support pagination', async () => {
      // Create 5 transactions
      for (let i = 0; i < 5; i++) {
        await repository.create({
          creditLineId: `cl-${i}`,
          amount: `${100 + i}.00`,
          type: TransactionType.BORROW
        });
      }

      const paginated = await repository.findAll(2, 2);
      expect(paginated).toHaveLength(2);
    });

    it('should use deterministic ordering when timestamps are equal', async () => {
      const txA = await repository.create({
        creditLineId: 'cl-1',
        amount: '10.00',
        type: TransactionType.BORROW
      });

      const txB = await repository.create({
        creditLineId: 'cl-2',
        amount: '20.00',
        type: TransactionType.REPAY
      });

      const sameCreatedAt = new Date('2026-01-01T00:00:00.000Z');
      repository['transactions'].set(txA.id, { ...txA, createdAt: sameCreatedAt });
      repository['transactions'].set(txB.id, { ...txB, createdAt: sameCreatedAt });

      const all = await repository.findAll();
      const expectedOrder = [txA.id, txB.id].sort((a, b) => a.localeCompare(b));

      expect(all.slice(0, 2).map((tx) => tx.id)).toEqual(expectedOrder);
    });
  });

  describe('count', () => {
    it('should return correct count', async () => {
      expect(await repository.count()).toBe(0);

      await repository.create({
        creditLineId: 'cl-123',
        amount: '100.00',
        type: TransactionType.BORROW
      });

      expect(await repository.count()).toBe(1);

      await repository.create({
        creditLineId: 'cl-456',
        amount: '50.00',
        type: TransactionType.REPAY
      });

      expect(await repository.count()).toBe(2);
    });
  });

  describe('findByStatus', () => {
    it('should return transactions with specific status', async () => {
      const tx1 = await repository.create({
        creditLineId: 'cl-123',
        amount: '100.00',
        type: TransactionType.BORROW
      });

      const tx2 = await repository.create({
        creditLineId: 'cl-456',
        amount: '50.00',
        type: TransactionType.REPAY
      });

      await repository.updateStatus(tx1.id, TransactionStatus.CONFIRMED);

      const pending = await repository.findByStatus(TransactionStatus.PENDING);
      const confirmed = await repository.findByStatus(TransactionStatus.CONFIRMED);

      expect(pending).toHaveLength(1);
      expect(pending[0].id).toBe(tx2.id);

      expect(confirmed).toHaveLength(1);
      expect(confirmed[0].id).toBe(tx1.id);
    });

    it('should support pagination', async () => {
      // Create 3 pending transactions
      for (let i = 0; i < 3; i++) {
        await repository.create({
          creditLineId: `cl-${i}`,
          amount: `${100 + i}.00`,
          type: TransactionType.BORROW
        });
      }

      const paginated = await repository.findByStatus(TransactionStatus.PENDING, 1, 1);
      expect(paginated).toHaveLength(1);
    });

    it('should return empty array when no transactions with status found', async () => {
      const transactions = await repository.findByStatus(TransactionStatus.CONFIRMED);
      expect(transactions).toEqual([]);
    });
  });

  describe('clear', () => {
    it('should clear all transactions', () => {
      void repository.create({
        creditLineId: 'cl-123',
        amount: '100.00',
        type: TransactionType.BORROW
      });

      repository.clear();

      expect(repository['transactions'].size).toBe(0);
    });
  });
});
