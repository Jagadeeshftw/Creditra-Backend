import type { Request, Response, NextFunction } from 'express';
import { fail } from '../utils/response.js';

/**
 * Standard error response interface for OpenAPI documentation
 */
export interface ErrorResponse {
  data: null;
  error: string;
}

/**
 * Global error-handling middleware.
 *
 * Catches any unhandled errors thrown (or passed via `next(err)`) from route
 * handlers and returns a consistent JSON error response using the fail() helper.
 * 
 * In production, stack traces and internal error details are not leaked.
 */
export function errorHandler(
  err: unknown,
  _req: Request,
  res: Response,
  _next: NextFunction,
): void {
  const maybeError = err as { status?: number; type?: string };

  // Body-parser emits this type when the payload exceeds the configured limit.
  if (maybeError.type === 'entity.too.large' || maybeError.status === 413) {
    fail(res, 'Request body too large. Maximum size is 100kb.', 413);
    return;
  }

  if (err instanceof Error) {
    console.error('[errorHandler]', {
      message: err.message,
      stack: err.stack,
      name: err.name,
    });

    const status = maybeError.status ?? statusFromName(err.name);
    fail(res, status >= 500 ? 'Internal server error' : err.message, status);
    return;
  }

  console.error('[errorHandler]', err);
  fail(res, typeof err === 'string' ? err : 'Internal server error', 500);
}

function statusFromName(name: string): number {
  switch (name) {
    case 'ValidationError':
      return 400;
    case 'UnauthorizedError':
      return 401;
    case 'ForbiddenError':
      return 403;
    case 'NotFoundError':
      return 404;
    default:
      return 500;
  }
}
