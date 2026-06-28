/**
 * Credit-line routes mounted at `/api/credit` by `src/index.ts`.
 *
 * Surface (see `docs/API.md` for full request/response shapes):
 * - GET    `/lines`                            — list (public)
 * - GET    `/lines/:id`                        — fetch (public)
 * - POST   `/lines`                            — create (validated body)
 * - PUT    `/lines/:id`                        — patch
 * - DELETE `/lines/:id`                        — delete
 * - GET    `/wallet/:walletAddress/lines`      — by wallet (validated path)
 * - GET    `/lines/:id/transactions`           — history with filters & paging
 * - POST   `/lines/:id/draw`                   — draw (validated body)
 * - POST   `/lines/:id/repay`                  — repay (validated body)
 * - POST   `/lines/:id/suspend`                — admin-auth state transition
 * - POST   `/lines/:id/close`                  — admin-auth state transition
 *
 * Domain errors are mapped to HTTP status by {@link handleServiceError}:
 * - {@link CreditLineNotFoundError} → 404
 * - {@link InvalidTransitionError}  → 409
 * - anything else                   → 500
 *
 * Successful responses use the shared envelope helpers `ok()` / `fail()`
 * from `src/utils/response.ts` so every body looks like `{ data, error }`.
 */
import { Router, type Request, type Response } from 'express';
import { validateBody } from '../middleware/validate.js';
import {
  createCreditLineSchema,
  drawSchema,
  repaySchema,
} from '../schemas/index.js';
import type { DrawBody, RepayBody } from '../schemas/index.js';
import { Container } from '../container/Container.js';
import { adminAuth } from '../middleware/adminAuth.js';
import { ok, fail } from '../utils/response.js';
import {
  CreditLineNotFoundError,
  InvalidTransitionError,
  VersionConflictError,
  TransactionType,
  suspendCreditLine,
  closeCreditLine,
  getTransactions,
  submitDrawRequest,
  submitRepayRequest,
} from '../services/creditService.js';

export const creditRouter = Router();
const container = Container.getInstance();

const VALID_TRANSACTION_TYPES = Object.values(TransactionType);

/**
 * Maps a thrown service-layer error to an HTTP status + envelope.
 *
 * - {@link CreditLineNotFoundError} → 404
 * - {@link InvalidTransitionError}  → 409
 * - anything else                   → 500 with the error message
 *
 * Keeping this in one place means every credit-line endpoint produces a
 * consistent error envelope without each handler reimplementing the
 * mapping.
 */
function handleServiceError(err: unknown, res: Response): void {
  if (err instanceof CreditLineNotFoundError) {
    fail(res, err.message, 404);
    return;
  }
  if (err instanceof InvalidTransitionError) {
    fail(res, err.message, 409);
    return;
  }
  if (err instanceof VersionConflictError) {
    fail(res, err.message, 409);
    return;
  }
  const message = err instanceof Error ? err.message : 'Internal server error';
  res.status(500).json({ error: message });
}

function parseIntegerQuery(value: unknown, defaultValue: number): number {
  if (value === undefined || value === '') {
    return defaultValue;
  }
  return Number.parseInt(String(value), 10);
}

creditRouter.get('/lines', async (req, res) => {
  const limit = parseIntegerQuery(req.query.limit, 100);

  try {
    if ('cursor' in req.query) {
      const cursorValue = req.query.cursor;
      const cursor = typeof cursorValue === 'string' && cursorValue.length > 0
        ? cursorValue
        : undefined;
      const result = await container.creditLineService.getAllCreditLinesWithCursor(cursor, limit);

      return res.json({
        creditLines: result.items,
        pagination: {
          limit,
          nextCursor: result.nextCursor,
          hasMore: result.hasMore,
        },
      });
    }

    const offset = parseIntegerQuery(req.query.offset, 0);
    const creditLines = await container.creditLineService.getAllCreditLines(offset, limit);
    const total = await container.creditLineService.getCreditLineCount();

    return ok(res, {
      creditLines,
      pagination: { total, offset, limit },
    });
  } catch (error) {
    return fail(res, error instanceof Error ? error : undefined, 400);
  }
});

creditRouter.get('/lines/:id', async (req, res) => {
  try {
    const line = await container.creditLineService.getCreditLine(req.params.id);
    if (!line) {
      return fail(res, 'Credit line not found', 404);
    }
    return ok(res, line);
  } catch {
    return fail(res, 'Internal server error');
  }
});

creditRouter.post('/lines', validateBody(createCreditLineSchema), async (req, res) => {
  try {
    const { walletAddress, creditLimit, requestedLimit, interestRateBps } = req.body ?? {};
    const finalLimit = creditLimit ?? requestedLimit;
    const creditLine = await container.creditLineService.createCreditLine({
      walletAddress,
      creditLimit: finalLimit,
      interestRateBps: interestRateBps ?? 0,
    });
    return ok(res, creditLine, 201);
  } catch (error) {
    return fail(res, error instanceof Error ? error : undefined, 400);
  }
});

creditRouter.put('/lines/:id', async (req, res) => {
  try {
    const { creditLimit, interestRateBps, status, expectedVersion } = req.body;
    const creditLine = await container.creditLineService.updateCreditLine(req.params.id, {
      creditLimit,
      interestRateBps,
      status,
      expectedVersion,
    });
    if (!creditLine) {
      return fail(res, 'Credit line not found', 404);
    }
    return ok(res, creditLine);
  } catch (error) {
    // Optimistic-locking conflicts surface as 409; other validation as 400.
    if (error instanceof VersionConflictError) {
      return handleServiceError(error, res);
    }
    return fail(res, error instanceof Error ? error : undefined, 400);
  }
});

creditRouter.delete('/lines/:id', async (req, res) => {
  try {
    const deleted = await container.creditLineService.deleteCreditLine(req.params.id);
    if (!deleted) {
      return fail(res, 'Credit line not found', 404);
    }
    return res.status(204).send();
  } catch {
    return fail(res, 'Internal server error');
  }
});

creditRouter.get(
  '/wallet/:walletAddress/lines',
  async (req, res) => {
  try {
    const lines = await container.creditLineService.getCreditLinesByWallet(
      req.params.walletAddress,
    );
    ok(res, { creditLines: lines });
  } catch {
    fail(res, 'Internal server error');
  }
});

creditRouter.get(
  '/lines/:id/transactions',
  async (req: Request, res: Response): Promise<void> => {
    const id = req.params.id;
    const { type, from, to, page: pageParam, limit: limitParam } = req.query;

    if (type !== undefined && !VALID_TRANSACTION_TYPES.includes(type as TransactionType)) {
      fail(res, `Invalid type filter. Must be one of: ${VALID_TRANSACTION_TYPES.join(', ')}.`, 400);
      return;
    }
    if (from !== undefined && isNaN(new Date(from as string).getTime())) {
      fail(res, "Invalid 'from' date. Must be a valid ISO 8601 date.", 400);
      return;
    }
    if (to !== undefined && isNaN(new Date(to as string).getTime())) {
      fail(res, "Invalid 'to' date. Must be a valid ISO 8601 date.", 400);
      return;
    }

    const page = pageParam !== undefined ? parseInt(pageParam as string, 10) : 1;
    const limit = limitParam !== undefined ? parseInt(limitParam as string, 10) : 20;

    if (isNaN(page) || page < 1) {
      fail(res, "Invalid 'page'. Must be a positive integer.", 400);
      return;
    }
    if (isNaN(limit) || limit < 1 || limit > 100) {
      fail(res, "Invalid 'limit'. Must be between 1 and 100.", 400);
      return;
    }

    try {
      const result = getTransactions(
        id,
        { type: type as TransactionType | undefined, from: from as string | undefined, to: to as string | undefined },
        { page, limit },
      );
      ok(res, result);
    } catch (err) {
      handleServiceError(err, res);
    }
  },
);

creditRouter.post(
  '/lines/:id/suspend',
  adminAuth,
  (req: Request, res: Response): void => {
    try {
      const line = suspendCreditLine(req.params.id);
      res.status(200).json({ data: line, message: 'Credit line suspended.', error: null });
    } catch (err) {
      handleServiceError(err, res);
    }
  },
);

creditRouter.post(
  '/lines/:id/close',
  adminAuth,
  (req: Request, res: Response): void => {
    try {
      const line = closeCreditLine(req.params.id);
      res.status(200).json({ data: line, message: 'Credit line closed.', error: null });
    } catch (err) {
      handleServiceError(err, res);
    }
  },
);

creditRouter.post('/lines/:id/draw', validateBody(drawSchema), async (req, res, next) => {
  try {
    const result = await submitDrawRequest(req.params.id, req.body as DrawBody);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

creditRouter.post('/lines/:id/repay', validateBody(repaySchema), async (req, res, next) => {
  try {
    const result = await submitRepayRequest(req.params.id, req.body as RepayBody);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

export default creditRouter;
