import type { Request, Response, NextFunction } from "express";
import { randomUUID } from "crypto";
import { logger } from "../utils/logger.js";
import { redactLogString } from "../utils/logRedact.js";

export const REQUEST_ID_HEADER = "x-request-id";

/**
 * Extend Express Request to include requestId
 */
declare module "express-serve-static-core" {
  interface Request {
    requestId?: string;
  }
}

function sanitizeWallet(address?: string): string | undefined {
  if (!address || typeof address !== "string") return undefined;

  // Truncate to avoid logging full PII
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

export function requestLogger(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  const start = Date.now();

  // 1. Get or generate requestId
  const incomingId = req.headers[REQUEST_ID_HEADER] as string | undefined;
  const requestId = incomingId ?? randomUUID();

  // 2. Attach to request
  req.requestId = requestId;

  // 3. Attach to response
  res.setHeader(REQUEST_ID_HEADER, requestId);

  // 4. Log request start
  const path = redactLogString(req.originalUrl, false);
  logger.info(
    {
      requestId,
      method: req.method,
      path,
    },
    "request:start",
  );

  // 5. Log response finish
  res.on("finish", () => {
    const duration = Date.now() - start;

    const wallet =
      typeof req.body?.walletAddress === "string"
        ? sanitizeWallet(req.body.walletAddress)
        : undefined;

    logger.info(
      {
        requestId,
        method: req.method,
        path,
        statusCode: res.statusCode,
        durationMs: duration,
        walletAddress: wallet, // sanitized
      },
      "request:end",
    );
  });

  next();
}
