import { describe, it, expect, beforeEach, vi } from 'vitest';
import { CreditLineService } from '../CreditLineService.js';
import type { CreditLineRepository } from '../../repositories/interfaces/CreditLineRepository.js';
import { type CreditLine, CreditLineStatus } from '../../models/CreditLine.js';

describe('CreditLineService', () => {
  let service: CreditLineService;
  let mockRepository: CreditLineRepository;

  beforeEach(() => {
    mockRepository = {
      create: vi.fn(),
      findById: vi.fn(),
      findByWalletAddress: vi.fn(),
      findAll: vi.fn(),
      findAllWithCursor: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
      exists: vi.fn(),
      count: vi.fn()
    };
    
    service = new CreditLineService(mockRepository);
  });

  describe('createCreditLine', () => {
    it('should create credit line successfully', async () => {
      const request = {
        walletAddress: 'GBAHQCUPC7G2B4D2F2I2K2M2O2Q2S2U2W2Y2A2C2E2G2I2K2M2O2Q2S1',
        creditLimit: '1000.00',
        interestRateBps: 500
      };

      const expectedCreditLine: CreditLine = {
        id: 'cl-123',
        walletAddress: request.walletAddress,
        creditLimit: request.creditLimit,
        availableCredit: request.creditLimit,
        utilized: '0',
        interestRateBps: request.interestRateBps,
        status: CreditLineStatus.ACTIVE,
        createdAt: new Date(),
        updatedAt: new Date()
      };

      vi.mocked(mockRepository.create).mockResolvedValue(expectedCreditLine);

      const result = await service.createCreditLine(request);

      expect(mockRepository.create).toHaveBeenCalledWith(request);
      expect(result).toEqual(expectedCreditLine);
    });

    it('should throw error for missing wallet address', async () => {
      const request = {
        walletAddress: '',
        creditLimit: '1000.00',
        interestRateBps: 500
      };

      await expect(service.createCreditLine(request)).rejects.toThrow('Wallet address is required');
    });

    it('should throw error for invalid credit limit', async () => {
      const request = {
        walletAddress: 'GBAHQCUPC7G2B4D2F2I2K2M2O2Q2S2U2W2Y2A2C2E2G2I2K2M2O2Q2S1',
        creditLimit: '0',
        interestRateBps: 500
      };

      await expect(service.createCreditLine(request)).rejects.toThrow('Credit limit must be greater than 0');
    });

    it('should throw error for invalid interest rate', async () => {
      const request = {
        walletAddress: 'GBAHQCUPC7G2B4D2F2I2K2M2O2Q2S2U2W2Y2A2C2E2G2I2K2M2O2Q2S1',
        creditLimit: '1000.00',
        interestRateBps: -100
      };

      await expect(service.createCreditLine(request)).rejects.toThrow('Interest rate must be between 0 and 10000 basis points');
    });
  });

  describe('getCreditLine', () => {
    it('should return credit line when found', async () => {
      const creditLine: CreditLine = {
        id: 'cl-123',
        walletAddress: 'GBAHQCUPC7G2B4D2F2I2K2M2O2Q2S2U2W2Y2A2C2E2G2I2K2M2O2Q2S1',
        creditLimit: '1000.00',
        availableCredit: '1000.00',
        utilized: '0',
        interestRateBps: 500,
        status: CreditLineStatus.ACTIVE,
        createdAt: new Date(),
        updatedAt: new Date()
      };

      vi.mocked(mockRepository.findById).mockResolvedValue(creditLine);

      const result = await service.getCreditLine('cl-123');

      expect(mockRepository.findById).toHaveBeenCalledWith('cl-123');
      expect(result).toEqual(creditLine);
    });

    it('should return null when not found', async () => {
      vi.mocked(mockRepository.findById).mockResolvedValue(null);

      const result = await service.getCreditLine('nonexistent');

      expect(result).toBeNull();
    });
  });

  describe('getCreditLinesByWallet', () => {
    it('should return credit lines for wallet', async () => {
      const creditLines: CreditLine[] = [
        {
          id: 'cl-123',
          walletAddress: 'GBAHQCUPC7G2B4D2F2I2K2M2O2Q2S2U2W2Y2A2C2E2G2I2K2M2O2Q2S1',
          creditLimit: '1000.00',
          availableCredit: '1000.00',
          utilized: '0',
          interestRateBps: 500,
          status: CreditLineStatus.ACTIVE,
          createdAt: new Date(),
          updatedAt: new Date()
        }
      ];

      vi.mocked(mockRepository.findByWalletAddress).mockResolvedValue(creditLines);

      const result = await service.getCreditLinesByWallet('GBAHQCUPC7G2B4D2F2I2K2M2O2Q2S2U2W2Y2A2C2E2G2I2K2M2O2Q2S1');

      expect(mockRepository.findByWalletAddress).toHaveBeenCalledWith('GBAHQCUPC7G2B4D2F2I2K2M2O2Q2S2U2W2Y2A2C2E2G2I2K2M2O2Q2S1');
      expect(result).toEqual(creditLines);
    });
  });

  describe('updateCreditLine', () => {
    it('should update credit line successfully', async () => {
      const updateRequest = {
        creditLimit: '2000.00',
        interestRateBps: 600
      };

      const updatedCreditLine: CreditLine = {
        id: 'cl-123',
        walletAddress: 'GBAHQCUPC7G2B4D2F2I2K2M2O2Q2S2U2W2Y2A2C2E2G2I2K2M2O2Q2S1',
        creditLimit: '2000.00',
        availableCredit: '2000.00',
        utilized: '0',
        interestRateBps: 600,
        status: CreditLineStatus.ACTIVE,
        createdAt: new Date(),
        updatedAt: new Date()
      };

      vi.mocked(mockRepository.update).mockResolvedValue(updatedCreditLine);

      const result = await service.updateCreditLine('cl-123', updateRequest);

      expect(mockRepository.update).toHaveBeenCalledWith('cl-123', updateRequest);
      expect(result).toEqual(updatedCreditLine);
    });

    it('should throw error for invalid credit limit', async () => {
      const updateRequest = {
        creditLimit: '-100.00'
      };

      await expect(service.updateCreditLine('cl-123', updateRequest)).rejects.toThrow('Credit limit must be greater than 0');
    });

    it('should throw error for invalid interest rate', async () => {
      const updateRequest = {
        interestRateBps: 15000
      };

      await expect(service.updateCreditLine('cl-123', updateRequest)).rejects.toThrow('Interest rate must be between 0 and 10000 basis points');
    });
  });

  describe('deleteCreditLine', () => {
    it('should delete credit line successfully', async () => {
      vi.mocked(mockRepository.delete).mockResolvedValue(true);

      const result = await service.deleteCreditLine('cl-123');

      expect(mockRepository.delete).toHaveBeenCalledWith('cl-123');
      expect(result).toBe(true);
    });
  });

  describe('getCreditLineCount', () => {
    it('should return count', async () => {
      vi.mocked(mockRepository.count).mockResolvedValue(5);

      const result = await service.getCreditLineCount();

      expect(mockRepository.count).toHaveBeenCalled();
      expect(result).toBe(5);
    });
  });

  describe('getAllCreditLines', () => {
    it('should return all credit lines successfully with valid pagination', async () => {
      const creditLines: CreditLine[] = [
        { id: 'cl-1', walletAddress: 'w1', creditLimit: '100', availableCredit: '100', utilized: '0', interestRateBps: 500, status: CreditLineStatus.ACTIVE, createdAt: new Date(), updatedAt: new Date() }
      ];
      vi.mocked(mockRepository.findAll).mockResolvedValue(creditLines);

      const result = await service.getAllCreditLines(0, 10);
      expect(mockRepository.findAll).toHaveBeenCalledWith(0, 10);
      expect(result).toEqual(creditLines);
    });

    it('should throw error for negative offset', async () => {
      await expect(service.getAllCreditLines(-1, 10)).rejects.toThrow('Offset cannot be negative');
    });

    it('should throw error for zero limit', async () => {
      await expect(service.getAllCreditLines(0, 0)).rejects.toThrow('Limit must be greater than 0');
    });

    it('should throw error for negative limit', async () => {
      await expect(service.getAllCreditLines(0, -5)).rejects.toThrow('Limit must be greater than 0');
    });

    it('should throw error for oversized limit', async () => {
      await expect(service.getAllCreditLines(0, 101)).rejects.toThrow('Limit cannot exceed 100');
    });
  });

  describe('getAllCreditLinesWithCursor', () => {
    it('should return credit lines with cursor pagination', async () => {
      const creditLines: CreditLine[] = [
        { id: 'cl-1', walletAddress: 'w1', creditLimit: '100', availableCredit: '100', utilized: '0', interestRateBps: 500, status: CreditLineStatus.ACTIVE, createdAt: new Date(), updatedAt: new Date() }
      ];
      
      const mockResult = {
        items: creditLines,
        nextCursor: 'base64cursor',
        hasMore: true
      };

      vi.mocked(mockRepository.findAllWithCursor).mockResolvedValue(mockResult);

      const result = await service.getAllCreditLinesWithCursor(undefined, 10);
      
      expect(mockRepository.findAllWithCursor).toHaveBeenCalledWith(undefined, 10);
      expect(result).toEqual(mockResult);
      expect(result.items).toEqual(creditLines);
      expect(result.nextCursor).toBe('base64cursor');
      expect(result.hasMore).toBe(true);
    });

    it('should handle cursor parameter', async () => {
      const mockResult = {
        items: [],
        nextCursor: null,
        hasMore: false
      };

      vi.mocked(mockRepository.findAllWithCursor).mockResolvedValue(mockResult);

      const result = await service.getAllCreditLinesWithCursor('somecursor', 20);
      
      expect(mockRepository.findAllWithCursor).toHaveBeenCalledWith('somecursor', 20);
      expect(result.nextCursor).toBeNull();
      expect(result.hasMore).toBe(false);
    });

    it('should throw error for zero limit', async () => {
      await expect(service.getAllCreditLinesWithCursor(undefined, 0)).rejects.toThrow('Limit must be greater than 0');
    });

    it('should throw error for negative limit', async () => {
      await expect(service.getAllCreditLinesWithCursor(undefined, -5)).rejects.toThrow('Limit must be greater than 0');
    });

    it('should throw error for oversized limit', async () => {
      await expect(service.getAllCreditLinesWithCursor(undefined, 101)).rejects.toThrow('Limit cannot exceed 100');
    });

    it('should return empty result when no more items', async () => {
      const mockResult = {
        items: [],
        nextCursor: null,
        hasMore: false
      };

      vi.mocked(mockRepository.findAllWithCursor).mockResolvedValue(mockResult);

      const result = await service.getAllCreditLinesWithCursor('exhaustedcursor', 10);
      
      expect(result.items).toHaveLength(0);
      expect(result.nextCursor).toBeNull();
      expect(result.hasMore).toBe(false);
    });
  });
});
