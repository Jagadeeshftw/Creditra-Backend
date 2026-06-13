/**
 * In-process, fixed-window rate limiter.
 *
 * Each request is bucketed by a caller-supplied key (IP, API key, or a
 * composite) for the duration of `windowMs`. Once a bucket exceeds
 * `maxRequests` the middleware returns `429` with `Retry-After` and the
 * `{ data, error, retryAfter }` envelope.
 *
 * Every response (allowed or denied) carries the standard headers:
 * - `X-RateLimit-Limit`
 * - `X-RateLimit-Remaining`
 * - `X-RateLimit-Reset` (epoch seconds)
 *
 * The store is a `Map` and therefore single-process. A horizontally scaled
 * deployment should swap the storage for Redis without touching the
 * middleware's public surface — the {@link RateLimitOptions} contract and
 * the two ready-made key generators are intentionally storage-agnostic.
 *
 * See `docs/SECURITY.md` §5 for the operational tuning guide.
 */
import type { Request, Response, NextFunction } from 'express';

interface RateLimitEntry {
  count: number;
  resetAt: number;
}

interface RateLimitOptions {
  windowMs: number;
  maxRequests: number;
  keyGenerator: (req: Request) => string;
}

function getClientIp(req: Request): string {
  const forwarded = req.headers['x-forwarded-for'];
  if (typeof forwarded === 'string') {
    return forwarded.split(',')[0].trim();
  }
  return req.ip ?? 'unknown';
}

export function createIpKeyGenerator(): (req: Request) => string {
  return (req: Request) => getClientIp(req);
}

export function createApiKeyKeyGenerator(): (req: Request) => string {
  return (req: Request) => {
    const apiKey = req.headers['x-api-key'];
    if (typeof apiKey === 'string' && apiKey.length > 0) {
      return `apikey:${apiKey}`;
    }
    return `ip:${getClientIp(req)}`;
  };
}

export function createRateLimitMiddleware(options: RateLimitOptions) {
  const store = new Map<string, RateLimitEntry>();

  const cleanup = () => {
    const now = Date.now();
    for (const [key, entry] of store.entries()) {
      if (entry.resetAt <= now) {
        store.delete(key);
      }
    }
  };

  const getOrCreateEntry = (key: string, resetAt: number): RateLimitEntry => {
    const existing = store.get(key);
    if (existing && existing.resetAt > Date.now()) {
      return existing;
    }
    return { count: 0, resetAt };
  };

  return function rateLimitMiddleware(
    req: Request,
    res: Response,
    next: NextFunction,
  ): void {
    cleanup();

    const key = options.keyGenerator(req);
    const now = Date.now();
    const resetAt = now + options.windowMs;

    const entry = getOrCreateEntry(key, resetAt);
    entry.count++;
    entry.resetAt = resetAt;
    store.set(key, entry);

    const limit = options.maxRequests;
    const remaining = Math.max(0, limit - entry.count);
    const resetEpoch = Math.ceil(resetAt / 1000);

    res.set({
      'X-RateLimit-Limit': String(limit),
      'X-RateLimit-Remaining': String(remaining),
      'X-RateLimit-Reset': String(resetEpoch),
    });

    if (entry.count > limit) {
      const retryAfter = Math.ceil((resetAt - now) / 1000);
      res.set('Retry-After', String(retryAfter));
      res.status(429).json({
        data: null,
        error: `Too many requests. Please retry after ${retryAfter} seconds.`,
        retryAfter,
      });
      return;
    }

    next();
  };
}
