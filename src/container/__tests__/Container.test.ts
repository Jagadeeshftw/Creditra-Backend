import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Container } from '../Container.js';
import { InMemoryCreditLineRepository } from '../../repositories/memory/InMemoryCreditLineRepository.js';
import { InMemoryRiskEvaluationRepository } from '../../repositories/memory/InMemoryRiskEvaluationRepository.js';
import { InMemoryTransactionRepository } from '../../repositories/memory/InMemoryTransactionRepository.js';
import type { CreditLineRepository } from '../../repositories/interfaces/CreditLineRepository.js';
import type { RiskEvaluationRepository } from '../../repositories/interfaces/RiskEvaluationRepository.js';
import type { TransactionRepository } from '../../repositories/interfaces/TransactionRepository.js';
import { CreditLineStatus, type CreditLine } from '../../models/CreditLine.js';
import type { OnChainCreditRecord, SorobanRpcClient } from '../../services/reconciliationService.js';

describe('Container', () => {
  let container: Container;

  beforeEach(() => {
    // Reset singleton for each test to prevent state leakage
    Container['instance'] = undefined as any;
    container = Container.getInstance();
  });

  afterEach(() => {
    // Clean up singleton after each test
    Container['instance'] = undefined as any;
  });

  describe('getInstance', () => {
    it('should return singleton instance', () => {
      const instance1 = Container.getInstance();
      const instance2 = Container.getInstance();

      expect(instance1).toBe(instance2);
    });

    it('should initialize with default repositories and services', () => {
      expect(container.creditLineRepository).toBeInstanceOf(InMemoryCreditLineRepository);
      expect(container.riskEvaluationRepository).toBeInstanceOf(InMemoryRiskEvaluationRepository);
      expect(container.transactionRepository).toBeInstanceOf(InMemoryTransactionRepository);
      expect(container.creditLineService).toBeDefined();
      expect(container.riskEvaluationService).toBeDefined();
    });
  });

  describe('setRepositories', () => {
    it('should replace credit line repository and service', () => {
      const newCreditLineRepo = new InMemoryCreditLineRepository();
      const originalService = container.creditLineService;

      container.setRepositories({
        creditLineRepository: newCreditLineRepo
      });

      expect(container.creditLineRepository).toBe(newCreditLineRepo);
      expect(container.creditLineService).not.toBe(originalService);
    });

    it('should rebuild reconciliation service with the replacement credit line repository', async () => {
      const replacementLine: CreditLine = {
        id: 'replacement-cl-1',
        walletAddress: 'GTEST123',
        creditLimit: '10000.00',
        availableCredit: '10000.00',
        utilized: '0',
        interestRateBps: 500,
        status: CreditLineStatus.ACTIVE,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      const replacementRepo = {
        async findAll(): Promise<CreditLine[]> {
          return [replacementLine];
        },
      } as unknown as CreditLineRepository;
      const matchingSorobanClient: SorobanRpcClient = {
        async fetchAllCreditRecords(): Promise<OnChainCreditRecord[]> {
          return [
            {
              id: '0',
              walletAddress: 'GTEST123',
              creditLimit: '10000.00',
              availableCredit: '10000.00',
              interestRateBps: 500,
              status: 'active',
            },
          ];
        },
      };

      container.setRepositories({ creditLineRepository: replacementRepo });
      container.setSorobanClientForTesting(matchingSorobanClient);

      const result = await container.reconciliationService.reconcile();

      expect(result.totalChecked).toBe(1);
      expect(result.errors).toEqual([]);
      expect(result.mismatches).toEqual([]);
    });

    it('should replace risk evaluation repository and service', () => {
      const newRiskRepo = new InMemoryRiskEvaluationRepository();
      const originalService = container.riskEvaluationService;

      container.setRepositories({
        riskEvaluationRepository: newRiskRepo
      });

      expect(container.riskEvaluationRepository).toBe(newRiskRepo);
      expect(container.riskEvaluationService).not.toBe(originalService);
    });

    it('should replace transaction repository', () => {
      const newTransactionRepo = new InMemoryTransactionRepository();

      container.setRepositories({
        transactionRepository: newTransactionRepo
      });

      expect(container.transactionRepository).toBe(newTransactionRepo);
    });

    it('should replace multiple repositories at once', () => {
      const newCreditLineRepo = new InMemoryCreditLineRepository();
      const newRiskRepo = new InMemoryRiskEvaluationRepository();
      const newTransactionRepo = new InMemoryTransactionRepository();

      container.setRepositories({
        creditLineRepository: newCreditLineRepo,
        riskEvaluationRepository: newRiskRepo,
        transactionRepository: newTransactionRepo
      });

      expect(container.creditLineRepository).toBe(newCreditLineRepo);
      expect(container.riskEvaluationRepository).toBe(newRiskRepo);
      expect(container.transactionRepository).toBe(newTransactionRepo);
    });

    it('should not affect other repositories when replacing one', () => {
      const originalRiskRepo = container.riskEvaluationRepository;
      const originalTransactionRepo = container.transactionRepository;
      const newCreditLineRepo = new InMemoryCreditLineRepository();

      container.setRepositories({
        creditLineRepository: newCreditLineRepo
      });

      expect(container.riskEvaluationRepository).toBe(originalRiskRepo);
      expect(container.transactionRepository).toBe(originalTransactionRepo);
    });
  });

  describe('Dependency Injection with Mock Repositories', () => {
    // Mock SQL repository implementations for testing
    class MockSqlCreditLineRepository implements CreditLineRepository {
      constructor(private readonly name: string) {}
      
      async create(): Promise<any> { return { id: 'sql-1', name: this.name }; }
      async findById(): Promise<any> { return null; }
      async findByWalletAddress(): Promise<any[]> { return []; }
      async findAll(): Promise<any[]> { return []; }
      async findAllWithCursor(): Promise<any> { return { items: [], nextCursor: null, hasMore: false }; }
      async update(): Promise<any> { return null; }
      async delete(): Promise<boolean> { return false; }
      async exists(): Promise<boolean> { return false; }
      async count(): Promise<number> { return 0; }
    }

    class MockSqlRiskEvaluationRepository implements RiskEvaluationRepository {
      constructor(private readonly name: string) {}
      
      async save(): Promise<any> { return { id: 'sql-risk-1', name: this.name }; }
      async findLatestByWalletAddress(): Promise<any> { return null; }
      async findById(): Promise<any> { return null; }
      async findByWalletAddress(): Promise<any[]> { return []; }
      async deleteExpired(): Promise<number> { return 0; }
      async isValid(): Promise<boolean> { return false; }
      async findAll(): Promise<any[]> { return []; }
      async count(): Promise<number> { return 0; }
    }

    class MockSqlTransactionRepository implements TransactionRepository {
      constructor(private readonly name: string) {}
      
      async create(): Promise<any> { return { id: 'sql-tx-1', name: this.name }; }
      async findById(): Promise<any> { return null; }
      async findByCreditLineId(): Promise<any[]> { return []; }
      async findByWalletAddress(): Promise<any[]> { return []; }
      async updateStatus(): Promise<any> { return null; }
      async findAll(): Promise<any[]> { return []; }
      async count(): Promise<number> { return 0; }
      async findByStatus(): Promise<any[]> { return []; }
    }

    it('should wire correctly with SQL repositories', () => {
      const sqlCreditLineRepo = new MockSqlCreditLineRepository('SQL-Credit');
      const sqlRiskRepo = new MockSqlRiskEvaluationRepository('SQL-Risk');
      const sqlTransactionRepo = new MockSqlTransactionRepository('SQL-Tx');

      container.setRepositories({
        creditLineRepository: sqlCreditLineRepo,
        riskEvaluationRepository: sqlRiskRepo,
        transactionRepository: sqlTransactionRepo
      });

      expect(container.creditLineRepository).toBe(sqlCreditLineRepo);
      expect(container.riskEvaluationRepository).toBe(sqlRiskRepo);
      expect(container.transactionRepository).toBe(sqlTransactionRepo);
      expect(container.creditLineService).toBeDefined();
      expect(container.riskEvaluationService).toBeDefined();
    });

    it('should handle mixed repository types (memory + SQL)', () => {
      const sqlCreditLineRepo = new MockSqlCreditLineRepository('SQL-Credit');
      // Keep other repositories as in-memory
      const originalRiskRepo = container.riskEvaluationRepository;
      const originalTransactionRepo = container.transactionRepository;

      container.setRepositories({
        creditLineRepository: sqlCreditLineRepo
      });

      expect(container.creditLineRepository).toBe(sqlCreditLineRepo);
      expect(container.riskEvaluationRepository).toBe(originalRiskRepo);
      expect(container.transactionRepository).toBe(originalTransactionRepo);
    });

    it('should create new service instances when repositories change', () => {
      const originalCreditLineService = container.creditLineService;
      const originalRiskService = container.riskEvaluationService;
      
      const sqlCreditLineRepo = new MockSqlCreditLineRepository('SQL-Credit');
      const sqlRiskRepo = new MockSqlRiskEvaluationRepository('SQL-Risk');

      container.setRepositories({
        creditLineRepository: sqlCreditLineRepo,
        riskEvaluationRepository: sqlRiskRepo
      });

      // Services should be recreated with new repositories
      expect(container.creditLineService).not.toBe(originalCreditLineService);
      expect(container.riskEvaluationService).not.toBe(originalRiskService);
    });
  });

  describe('Singleton Behavior and State Isolation', () => {
    it('should maintain singleton across multiple getInstance calls', () => {
      const instance1 = Container.getInstance();
      const instance2 = Container.getInstance();
      const instance3 = Container.getInstance();

      expect(instance1).toBe(instance2);
      expect(instance2).toBe(instance3);
    });

    it('should not leak global state across test suites', () => {
      // First container
      const container1 = Container.getInstance();
      const originalRepo1 = container1.creditLineRepository;
      
      // Reset and create new container (simulating new test suite)
      Container['instance'] = undefined as any;
      const container2 = Container.getInstance();
      
      // Should have different instances
      expect(container1).not.toBe(container2);
      expect(container1.creditLineRepository).not.toBe(container2.creditLineRepository);
      
      // Modifying container2 should not affect container1
      const newRepo = new InMemoryCreditLineRepository();
      container2.setRepositories({ creditLineRepository: newRepo });
      
      expect(container1.creditLineRepository).toBe(originalRepo1);
      expect(container2.creditLineRepository).toBe(newRepo);
    });

    it('should handle repository swapping without affecting other instances', () => {
      // Create multiple container instances by resetting singleton
      const containerA = Container.getInstance();
      
      Container['instance'] = undefined as any;
      const containerB = Container.getInstance();
      
      const newRepo = new InMemoryCreditLineRepository();
      
      // Swap repository in container B
      containerB.setRepositories({ creditLineRepository: newRepo });
      
      // Container A should remain unchanged
      expect(containerA.creditLineRepository).not.toBe(newRepo);
      expect(containerB.creditLineRepository).toBe(newRepo);
    });
  });

  describe('Service Integration', () => {
    it('should properly inject repositories into services', () => {
      const mockCreditLineRepo = new InMemoryCreditLineRepository();
      const mockRiskRepo = new InMemoryRiskEvaluationRepository();

      container.setRepositories({
        creditLineRepository: mockCreditLineRepo,
        riskEvaluationRepository: mockRiskRepo
      });

      // Verify services have access to the correct repositories
      // Note: This would require access to service internals or integration testing
      expect(container.creditLineService).toBeDefined();
      expect(container.riskEvaluationService).toBeDefined();
    });

    it('should handle empty setRepositories call', () => {
      const originalCreditLineRepo = container.creditLineRepository;
      const originalRiskRepo = container.riskEvaluationRepository;
      const originalTransactionRepo = container.transactionRepository;
      const originalCreditLineService = container.creditLineService;
      const originalRiskService = container.riskEvaluationService;

      // Call with empty object
      container.setRepositories({});

      // Nothing should change
      expect(container.creditLineRepository).toBe(originalCreditLineRepo);
      expect(container.riskEvaluationRepository).toBe(originalRiskRepo);
      expect(container.transactionRepository).toBe(originalTransactionRepo);
      expect(container.creditLineService).toBe(originalCreditLineService);
      expect(container.riskEvaluationService).toBe(originalRiskService);
    });
  });

  describe('Extension Pattern Documentation', () => {
    it('should demonstrate extension pattern for new services', () => {
      // This test documents how to extend the container for new services
      // Example: Adding a new "NotificationService" that depends on repositories
      
      // Mock new repository interface
      interface NotificationRepository {
        send(notification: any): Promise<void>;
      }

      // Mock implementation
      class MockNotificationRepository implements NotificationRepository {
        async send(): Promise<void> {
          // Mock implementation
        }
      }

      // This test documents the pattern:
      // 1. Add repository property to Container class
      // 2. Add service property to Container class
      // 3. Initialize in constructor
      // 4. Add getter methods
      // 5. Update setRepositories method
      
      const notificationRepo = new MockNotificationRepository();
      expect(notificationRepo).toBeDefined();
      
      // The actual extension would require modifying Container.ts
      // This test serves as documentation for the pattern
    });
  });
});
