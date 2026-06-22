/**
 * Composition root for the backend.
 *
 * `Container` is a lazy singleton that wires up the dependency graph:
 * - selects a {@link CreditLineRepository} implementation based on
 *   `DATABASE_URL` and `NODE_ENV` (Postgres in production, in-memory
 *   everywhere else),
 * - constructs the service layer that route handlers depend on,
 * - instantiates the Soroban client and the reconciliation pipeline,
 * - exposes a graceful {@link Container.shutdown} method that the boot
 *   harness invokes on `SIGTERM` / `SIGINT`.
 *
 * Tests bypass env-var gymnastics by calling {@link Container.setRepositories}
 * with stubs, or by reaching into the container via `getInstance()` after
 * setting `NODE_ENV=test`.
 *
 * See `docs/ARCHITECTURE.md` §1 (Wiring) for the boot order.
 */
import { type CreditLineRepository } from "../repositories/interfaces/CreditLineRepository.js";
import { type RiskEvaluationRepository } from "../repositories/interfaces/RiskEvaluationRepository.js";
import { type TransactionRepository } from "../repositories/interfaces/TransactionRepository.js";
import { InMemoryCreditLineRepository } from "../repositories/memory/InMemoryCreditLineRepository.js";
import { InMemoryRiskEvaluationRepository } from "../repositories/memory/InMemoryRiskEvaluationRepository.js";
import { InMemoryTransactionRepository } from "../repositories/memory/InMemoryTransactionRepository.js";
import { PostgresCreditLineRepository } from "../repositories/postgres/PostgresCreditLineRepository.js";
import { CreditLineService } from "../services/CreditLineService.js";
import { RiskEvaluationService } from "../services/RiskEvaluationService.js";
import { ReconciliationService } from "../services/reconciliationService.js";
import { ReconciliationWorker } from "../services/reconciliationWorker.js";
import { MockSorobanClient, resolveSorobanConfig } from "../services/sorobanClient.js";
import { defaultJobQueue } from "../services/jobQueue.js";
import { DataRetentionService } from "../services/dataRetentionService.js";
import { DataRetentionWorker } from "../services/dataRetentionWorker.js";

export class Container {
  private static instance: Container;

  // Database client
  private _dbClient?: DbClient;

  // Repositories
  private _creditLineRepository!: CreditLineRepository;
  private _riskEvaluationRepository!: RiskEvaluationRepository;
  private _transactionRepository!: TransactionRepository;

  // Services
  private _creditLineService: CreditLineService;
  private _riskEvaluationService: RiskEvaluationService;
  private _reconciliationService: ReconciliationService;
  private _reconciliationWorker: ReconciliationWorker;
  private _dataRetentionService?: DataRetentionService;
  private _dataRetentionWorker?: DataRetentionWorker;

  private constructor() {
    // Initialize repositories based on environment
    this.initializeRepositories();

    // Initialize services
    this._creditLineService = new CreditLineService(this._creditLineRepository);
    this._riskEvaluationService = new RiskEvaluationService(
      this._riskEvaluationRepository,
      createRiskProvider(),
    );
    
    // Initialize Soroban client and reconciliation services
    const sorobanConfig = resolveSorobanConfig();
    const sorobanClient = new MockSorobanClient(sorobanConfig);
    this._reconciliationService = new ReconciliationService(
      this._creditLineRepository,
      sorobanClient,
      defaultJobQueue,
    );
    this._reconciliationWorker = new ReconciliationWorker(
      this._reconciliationService,
      defaultJobQueue,
    );

    // Data retention requires a real Postgres connection (pgcrypto digest(),
    // borrowers.anonymized_at) — unavailable for in-memory/test repositories.
    if (this._dbClient) {
      this._dataRetentionService = new DataRetentionService(this._dbClient);
      this._dataRetentionWorker = new DataRetentionWorker(
        this._dataRetentionService,
        defaultJobQueue,
      );
    }
  }

  private initializeRepositories(): void {
    const useDatabase = process.env.DATABASE_URL && process.env.NODE_ENV !== 'test';
    
    if (useDatabase) {
      // Use PostgreSQL repositories
      this._dbClient = getConnection();
      this._creditLineRepository = new PostgresCreditLineRepository(this._dbClient);
      // TODO: Implement PostgreSQL versions of other repositories
      this._riskEvaluationRepository = new InMemoryRiskEvaluationRepository();
      this._transactionRepository = new InMemoryTransactionRepository();
    } else {
      // Use in-memory repositories (for development/testing)
      this._creditLineRepository = new InMemoryCreditLineRepository();
      this._riskEvaluationRepository = new InMemoryRiskEvaluationRepository();
      this._transactionRepository = new InMemoryTransactionRepository();
    }
  }

  public static getInstance(): Container {
    if (!Container.instance) {
      Container.instance = new Container();
    }
    return Container.instance;
  }

  // Repository getters
  get creditLineRepository(): CreditLineRepository {
    return this._creditLineRepository;
  }

  get riskEvaluationRepository(): RiskEvaluationRepository {
    return this._riskEvaluationRepository;
  }

  get transactionRepository(): TransactionRepository {
    return this._transactionRepository;
  }

  // Service getters
  get creditLineService(): CreditLineService {
    return this._creditLineService;
  }

  get riskEvaluationService(): RiskEvaluationService {
    return this._riskEvaluationService;
  }

  get reconciliationService(): ReconciliationService {
    return this._reconciliationService;
  }

  get reconciliationWorker(): ReconciliationWorker {
    return this._reconciliationWorker;
  }

  /** Undefined when running against in-memory repositories (no Postgres connection). */
  get dataRetentionWorker(): DataRetentionWorker | undefined {
    return this._dataRetentionWorker;
  }

  // Method to replace repositories (useful for testing or switching to DB implementations)
  public setRepositories(repositories: {
    creditLineRepository?: CreditLineRepository;
    riskEvaluationRepository?: RiskEvaluationRepository;
    transactionRepository?: TransactionRepository;
  }): void {
    if (repositories.creditLineRepository) {
      this._creditLineRepository = repositories.creditLineRepository;
      this._creditLineService = new CreditLineService(
        this._creditLineRepository,
      );
    }

    if (repositories.riskEvaluationRepository) {
      this._riskEvaluationRepository = repositories.riskEvaluationRepository;
      this._riskEvaluationService = new RiskEvaluationService(
        this._riskEvaluationRepository,
        createRiskProvider(),
      );
    }

    if (repositories.transactionRepository) {
      this._transactionRepository = repositories.transactionRepository;
    }
  }

  /**
   * Shutdown internal services and close database connections.
   */
  public async shutdown(): Promise<void> {
    console.log("[Container] Shutting down internal services...");

    // Stop reconciliation worker
    if (this._reconciliationWorker.isRunning()) {
      this._reconciliationWorker.stop();
    }

    // Stop data retention worker
    if (this._dataRetentionWorker?.isRunning()) {
      this._dataRetentionWorker.stop();
    }

    // Stop job queue
    defaultJobQueue.stop();

    // In the future, close database pools here:
    // await this.dbPool?.end();

    console.log("[Container] All services shut down.");
  }
}
