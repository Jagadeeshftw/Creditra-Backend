import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { resolveSorobanRpcConfig } from '../sorobanRpcClient.js';

describe('resolveSorobanRpcConfig', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it('uses documented defaults when environment variables are absent', () => {
    delete process.env.SOROBAN_RPC_URL;
    delete process.env.STELLAR_NETWORK_PASSPHRASE;
    delete process.env.SOROBAN_TIMEOUT_MS;
    delete process.env.SOROBAN_MAX_RETRIES;
    delete process.env.SOROBAN_RETRY_JITTER_MS;

    const config = resolveSorobanRpcConfig();

    expect(config).toEqual({
      rpcUrl: 'https://soroban-testnet.stellar.org',
      networkPassphrase: 'Test SDF Network ; September 2015',
      timeoutMs: 30_000,
      maxRetries: 3,
      retryJitterMs: 1_000,
    });
  });

  it('resolves overrides from environment variables', () => {
    process.env.SOROBAN_RPC_URL = 'https://custom-rpc.stellar.org';
    process.env.STELLAR_NETWORK_PASSPHRASE = 'Custom Network';
    process.env.SOROBAN_TIMEOUT_MS = '60000';
    process.env.SOROBAN_MAX_RETRIES = '5';
    process.env.SOROBAN_RETRY_JITTER_MS = '2000';

    const config = resolveSorobanRpcConfig();

    expect(config).toEqual({
      rpcUrl: 'https://custom-rpc.stellar.org',
      networkPassphrase: 'Custom Network',
      timeoutMs: 60_000,
      maxRetries: 5,
      retryJitterMs: 2_000,
    });
  });

  it('falls back when blank strings or malformed integers are provided', () => {
    process.env.SOROBAN_RPC_URL = '   ';
    process.env.STELLAR_NETWORK_PASSPHRASE = '';
    process.env.SOROBAN_TIMEOUT_MS = 'not-a-number';
    process.env.SOROBAN_MAX_RETRIES = 'NaN';
    process.env.SOROBAN_RETRY_JITTER_MS = '';

    const config = resolveSorobanRpcConfig();

    expect(config).toEqual({
      rpcUrl: 'https://soroban-testnet.stellar.org',
      networkPassphrase: 'Test SDF Network ; September 2015',
      timeoutMs: 30_000,
      maxRetries: 3,
      retryJitterMs: 1_000,
    });
  });
});
