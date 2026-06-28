export interface CreditLine {
  id: string;
  walletAddress: string;
  creditLimit: string; // Using string for precise decimal handling
  availableCredit: string;
  utilized: string;
  interestRateBps: number; // Basis points (e.g., 500 = 5%)
  status: CreditLineStatus;
  /**
   * Optimistic-locking version. Incremented on every successful update so
   * concurrent writers can detect lost-update conflicts. Starts at 1.
   */
  version?: number;
  createdAt: Date;
  updatedAt: Date;
}

export enum CreditLineStatus {
  ACTIVE = 'active',
  SUSPENDED = 'suspended',
  CLOSED = 'closed',
  PENDING = 'pending'
}

export interface CreateCreditLineRequest {
  walletAddress: string;
  creditLimit: string;
  interestRateBps: number;
}

export interface UpdateCreditLineRequest {
  creditLimit?: string;
  interestRateBps?: number;
  status?: CreditLineStatus;
  utilized?: string;
  /**
   * Optimistic-locking guard. When provided, the update only succeeds if the
   * stored {@link CreditLine.version} equals this value; otherwise the
   * repository signals a conflict (mapped to HTTP 409). Omit to update
   * unconditionally (last-write-wins, legacy behavior).
   */
  expectedVersion?: number;
}