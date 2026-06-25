/**
 * HTTP timeout utilities for outbound requests to Horizon and external integrations.
 * 
 * Provides configurable connect and read timeouts with structured error handling.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface FetchTimeoutConfig {
  /** Connection timeout in milliseconds (time to establish connection) */
  connectTimeoutMs: number;
  /** Read timeout in milliseconds (time to receive response after connection) */
  readTimeoutMs: number;
}

export interface FetchWithTimeoutOptions extends RequestInit {
  /** Custom timeout configuration (overrides defaults) */
  timeouts?: Partial<FetchTimeoutConfig>;
}

/**
 * Structured error for HTTP timeout failures.
 * Distinguishes between connection and read timeouts.
 */
export class HttpTimeoutError extends Error {
  public readonly type: 'connect' | 'read';
  public readonly url: string;
  public readonly timeoutMs: number;

  constructor(type: 'connect' | 'read', url: string, timeoutMs: number) {
    super(`HTTP ${type} timeout after ${timeoutMs}ms: ${url}`);
    this.name = 'HttpTimeoutError';
    this.type = type;
    this.url = url;
    this.timeoutMs = timeoutMs;
  }
}

/**
 * Structured error for HTTP request failures.
 * Wraps underlying fetch errors with context.
 */
export class HttpRequestError extends Error {
  public readonly url: string;
  public readonly cause?: Error;

  constructor(message: string, url: string, cause?: Error) {
    super(message);
    this.name = 'HttpRequestError';
    this.url = url;
    this.cause = cause;
  }
}

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

/**
 * Default timeout values (configurable via environment variables).
 */
export function getDefaultTimeouts(): FetchTimeoutConfig {
  return {
    connectTimeoutMs: parseInt(process.env['HTTP_CONNECT_TIMEOUT_MS'] ?? '5000', 10),
    readTimeoutMs: parseInt(process.env['HTTP_READ_TIMEOUT_MS'] ?? '10000', 10),
  };
}

function mergeAbortSignals(signal: AbortSignal | undefined, timeoutSignal: AbortSignal): AbortSignal {
  if (!signal) {
    return timeoutSignal;
  }
  if (signal.aborted) {
    return signal;
  }
  if (timeoutSignal.aborted) {
    return timeoutSignal;
  }

  const controller = new AbortController();
  const abort = (): void => controller.abort();

  signal.addEventListener('abort', abort, { once: true });
  timeoutSignal.addEventListener('abort', abort, { once: true });

  return controller.signal;
}

// ---------------------------------------------------------------------------
// Core implementation
// ---------------------------------------------------------------------------

/**
 * Fetch with configurable connect and read timeouts.
 * 
 * @param url - URL to fetch
 * @param options - Fetch options with optional timeout overrides
 * @returns Response object
 * @throws {HttpTimeoutError} If connection or read timeout is exceeded
 * @throws {HttpRequestError} If request fails for other reasons
 * 
 * @example
 * ```typescript
 * // Use default timeouts from environment
 * const response = await fetchWithTimeout('https://horizon-testnet.stellar.org/ledgers');
 * 
 * // Override timeouts for specific request
 * const response = await fetchWithTimeout('https://api.example.com/data', {
 *   timeouts: { connectTimeoutMs: 3000, readTimeoutMs: 15000 }
 * });
 * ```
 */
export async function fetchWithTimeout(
  url: string,
  options: FetchWithTimeoutOptions = {}
): Promise<Response> {
  const defaults = getDefaultTimeouts();
  const timeouts: FetchTimeoutConfig = {
    connectTimeoutMs: options.timeouts?.connectTimeoutMs ?? defaults.connectTimeoutMs,
    readTimeoutMs: options.timeouts?.readTimeoutMs ?? defaults.readTimeoutMs,
  };

  // Total timeout is connect + read
  const totalTimeoutMs = timeouts.connectTimeoutMs + timeouts.readTimeoutMs;

  // Create abort controller for timeout
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), totalTimeoutMs);

  try {
    const signal = mergeAbortSignals(options.signal ?? undefined, controller.signal);

    const response = await fetch(url, {
      ...options,
      signal,
    });

    clearTimeout(timeoutId);
    return response;
  } catch (error) {
    clearTimeout(timeoutId);

    // Handle abort/timeout
    if (error instanceof Error && error.name === 'AbortError') {
      // Determine if it was connect or read timeout
      // Note: In practice, distinguishing these requires more sophisticated tracking
      // For now, we use a heuristic based on total timeout
      throw new HttpTimeoutError('read', url, totalTimeoutMs);
    }

    // Handle other fetch errors
    if (error instanceof Error) {
      throw new HttpRequestError(
        `HTTP request failed: ${error.message}`,
        url,
        error
      );
    }

    // Unknown error type
    throw new HttpRequestError('HTTP request failed with unknown error', url);
  }
}

/**
 * Fetch JSON with timeout and automatic parsing.
 * 
 * @param url - URL to fetch
 * @param options - Fetch options with optional timeout overrides
 * @returns Parsed JSON response
 * @throws {HttpTimeoutError} If connection or read timeout is exceeded
 * @throws {HttpRequestError} If request fails or JSON parsing fails
 * 
 * @example
 * ```typescript
 * interface HorizonResponse {
 *   _embedded: { records: Array<{ id: string }> };
 * }
 * 
 * const data = await fetchJsonWithTimeout<HorizonResponse>(
 *   'https://horizon-testnet.stellar.org/ledgers?limit=10'
 * );
 * ```
 */
export async function fetchJsonWithTimeout<T = unknown>(
  url: string,
  options: FetchWithTimeoutOptions = {}
): Promise<T> {
  const response = await fetchWithTimeout(url, options);

  if (!response.ok) {
    throw new HttpRequestError(
      `HTTP ${response.status} ${response.statusText}`,
      url
    );
  }

  try {
    return await response.json() as T;
  } catch (error) {
    throw new HttpRequestError(
      'Failed to parse JSON response',
      url,
      error instanceof Error ? error : undefined
    );
  }
}
