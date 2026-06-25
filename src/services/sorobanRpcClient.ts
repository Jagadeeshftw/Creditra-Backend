const DEFAULT_SOROBAN_RPC_URL = 'https://soroban-testnet.stellar.org';
const DEFAULT_STELLAR_NETWORK_PASSPHRASE = 'Test SDF Network ; September 2015';
const DEFAULT_SOROBAN_TIMEOUT_MS = 30_000;
const DEFAULT_SOROBAN_MAX_RETRIES = 3;
const DEFAULT_SOROBAN_RETRY_JITTER_MS = 1_000;

export interface SorobanRpcConfig {
  rpcUrl: string;
  networkPassphrase: string;
  timeoutMs?: number;
  maxRetries?: number;
  retryJitterMs?: number;
}

/**
 * Shared configuration for Soroban RPC reads.
 *
 * The actual RPC implementation lives in `sorobanClient.ts`; this module stays
 * intentionally config-only so there is one place for retry, timeout, and
 * diagnostic behavior.
 */
export function resolveSorobanRpcConfig(): SorobanRpcConfig {
  return {
    rpcUrl: trimOrDefault(process.env['SOROBAN_RPC_URL'], DEFAULT_SOROBAN_RPC_URL),
    networkPassphrase: trimOrDefault(
      process.env['STELLAR_NETWORK_PASSPHRASE'],
      DEFAULT_STELLAR_NETWORK_PASSPHRASE,
    ),
    timeoutMs: parseIntegerEnv(process.env['SOROBAN_TIMEOUT_MS'], DEFAULT_SOROBAN_TIMEOUT_MS),
    maxRetries: parseIntegerEnv(process.env['SOROBAN_MAX_RETRIES'], DEFAULT_SOROBAN_MAX_RETRIES),
    retryJitterMs: parseIntegerEnv(
      process.env['SOROBAN_RETRY_JITTER_MS'],
      DEFAULT_SOROBAN_RETRY_JITTER_MS,
    ),
  };
}

function trimOrDefault(value: string | undefined, fallback: string): string {
  const trimmed = value?.trim() ?? '';
  return trimmed.length > 0 ? trimmed : fallback;
}

function parseIntegerEnv(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value ?? '', 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}
