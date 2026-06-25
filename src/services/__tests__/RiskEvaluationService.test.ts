import { describe, it, expect, beforeEach, vi } from 'vitest';
import { RiskEvaluationService } from '../RiskEvaluationService.js';
import type { RiskEvaluationRepository } from '../../repositories/interfaces/RiskEvaluationRepository.js';
import type { RiskEvaluation } from '../../models/RiskEvaluation.js';
import type { IRiskProvider, RiskProviderOutput } from '../providers/IRiskProvider.js';

const WALLET = 'GBAHQCUPC7G2B4D2F2I2K2M2O2Q2S2U2W2Y2A2C2E2G2I2K2M2O2Q2S1';

function buildCachedEval(overrides: Partial<RiskEvaluation> = {}): RiskEvaluation {
  const evaluatedAt = new Date('2026-01-01T00:00:00.000Z');
  return {
    id: 'eval-123',
    walletAddress: WALLET,
    riskScore: 75,
    creditLimit: '750.00',
    interestRateBps: 625,
    factors: [],
    evaluatedAt,
    expiresAt: new Date(evaluatedAt.getTime() + 24 * 60 * 60 * 1000),
    ...overrides,
  };
}

function buildMockProvider(score: number): IRiskProvider {
  const output: RiskProviderOutput = {
    score,
    factors: [],
  };

  return {
    name: 'mock',
    evaluate: vi.fn(async () => output),
  };
}

function buildMockRepo(): RiskEvaluationRepository {
  return {
    save: vi.fn(async (evaluation) => buildCachedEval(evaluation)),
    findLatestByWalletAddress: vi.fn(),
    findById: vi.fn(),
    findByWalletAddress: vi.fn(),
    deleteExpired: vi.fn(),
    isValid: vi.fn(),
    findAll: vi.fn(),
    count: vi.fn(),
  };
}

describe('RiskEvaluationService', () => {
  let service: RiskEvaluationService;
  let mockRepository: RiskEvaluationRepository;
  let mockProvider: IRiskProvider;

  beforeEach(() => {
    mockRepository = buildMockRepo();
    mockProvider = buildMockProvider(70);
    service = new RiskEvaluationService(mockRepository, mockProvider);
  });

  describe("evaluateRisk", () => {
    it("should throw error for missing wallet address", async () => {
      await expect(service.evaluateRisk({ walletAddress: "" })).rejects.toThrow(
        "Wallet address is required",
      );
    });

    it("should return cached evaluation when valid", async () => {
      const cached = buildCachedEval();
      vi.mocked(mockRepository.isValid).mockResolvedValue(true);
      vi.mocked(mockRepository.findLatestByWalletAddress).mockResolvedValue(
        cached,
      );

      const result = await service.evaluateRisk({ walletAddress: WALLET });

      expect(result.walletAddress).toBe(WALLET);
      expect(result.riskScore).toBe(75);
      expect(result.message).toBe("Using cached risk evaluation");
      expect(mockProvider.evaluate).not.toHaveBeenCalled();
    });

    it("should perform new evaluation when no valid cache", async () => {
      vi.mocked(mockRepository.isValid).mockResolvedValue(false);
      vi.mocked(mockRepository.save).mockResolvedValue(
        buildCachedEval({ riskScore: 70 }),
      );

      const result = await service.evaluateRisk({ walletAddress: WALLET });

      expect(result.walletAddress).toBe(WALLET);
      expect(result.riskScore).toBe(70);
      expect(result.message).toBe("New risk evaluation completed");
      expect(mockProvider.evaluate).toHaveBeenCalledWith(WALLET);
      expect(mockRepository.save).toHaveBeenCalled();
    });

    it("should force new evaluation when forceRefresh is true", async () => {
      vi.mocked(mockRepository.save).mockResolvedValue(
        buildCachedEval({ riskScore: 80 }),
      );

      const result = await service.evaluateRisk({
        walletAddress: WALLET,
        forceRefresh: true,
      });

      expect(result.message).toBe("New risk evaluation completed");
      expect(mockRepository.isValid).not.toHaveBeenCalled();
      expect(mockProvider.evaluate).toHaveBeenCalledWith(WALLET);
    });

    it("should derive creditLimit proportionally from score", async () => {
      const provider = buildMockProvider(50);
      const svc = new RiskEvaluationService(mockRepository, provider);
      vi.mocked(mockRepository.isValid).mockResolvedValue(false);
      const saved = buildCachedEval({ riskScore: 50, creditLimit: "500.00" });
      vi.mocked(mockRepository.save).mockResolvedValue(saved);

      const result = await svc.evaluateRisk({ walletAddress: WALLET });

      expect(result.creditLimit).toBe("500.00");
    });

    it("should call provider evaluate exactly once per fresh evaluation", async () => {
      vi.mocked(mockRepository.isValid).mockResolvedValue(false);
      vi.mocked(mockRepository.save).mockResolvedValue(buildCachedEval());

      await service.evaluateRisk({ walletAddress: WALLET });

      expect(mockProvider.evaluate).toHaveBeenCalledTimes(1);
    });
  });

  describe("getRiskEvaluation", () => {
    it("should return evaluation when found", async () => {
      const evaluation = buildCachedEval();
      vi.mocked(mockRepository.findById).mockResolvedValue(evaluation);

      const result = await service.getRiskEvaluation("eval-123");

      expect(mockRepository.findById).toHaveBeenCalledWith("eval-123");
      expect(result).toEqual(evaluation);
    });

    it("should return null when not found", async () => {
      vi.mocked(mockRepository.findById).mockResolvedValue(null);

      const result = await service.getRiskEvaluation("nonexistent");

      expect(result).toBeNull();
    });
  });

  describe("getLatestRiskEvaluation", () => {
    it("should return latest evaluation for wallet", async () => {
      const evaluation = buildCachedEval();
      vi.mocked(mockRepository.findLatestByWalletAddress).mockResolvedValue(
        evaluation,
      );

      const result = await service.getLatestRiskEvaluation(WALLET);

      expect(mockRepository.findLatestByWalletAddress).toHaveBeenCalledWith(
        WALLET,
      );
      expect(result).toEqual(evaluation);
    });

    it("should return null when no evaluation exists", async () => {
      vi.mocked(mockRepository.findLatestByWalletAddress).mockResolvedValue(
        null,
      );

      const result = await service.getLatestRiskEvaluation(WALLET);

      expect(result).toBeNull();
    });
  });

  describe("getRiskEvaluationHistory", () => {
    it("should return evaluation history for wallet", async () => {
      const evaluations = [buildCachedEval()];
      vi.mocked(mockRepository.findByWalletAddress).mockResolvedValue(
        evaluations,
      );

      const result = await service.getRiskEvaluationHistory(WALLET, 0, 10);

      expect(mockRepository.findByWalletAddress).toHaveBeenCalledWith(
        WALLET,
        0,
        10,
      );
      expect(result).toEqual(evaluations);
    });
  });

  describe("cleanupExpiredEvaluations", () => {
    it("should cleanup expired evaluations", async () => {
      vi.mocked(mockRepository.deleteExpired).mockResolvedValue(5);

      const result = await service.cleanupExpiredEvaluations();

      expect(mockRepository.deleteExpired).toHaveBeenCalled();
      expect(result).toBe(5);
    });
  });
});
