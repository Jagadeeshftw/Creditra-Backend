import type { Request, Response, NextFunction } from "express";
import { createHash, timingSafeEqual } from "node:crypto";

export const ADMIN_KEY_HEADER = "x-admin-api-key" as const;

function timingSafeStringEqual(left: string, right: string): boolean {
    const leftDigest = createHash("sha256").update(left, "utf8").digest();
    const rightDigest = createHash("sha256").update(right, "utf8").digest();

    return timingSafeEqual(leftDigest, rightDigest) && left.length === right.length;
}

export function adminAuth(
    req: Request,
    res: Response,
    next: NextFunction,
): void {
    const expectedKey = process.env["ADMIN_API_KEY"];

    if (!expectedKey) {
        res.status(503).json({
            error: "Admin authentication is not configured on this server.",
        });
        return;
    }

    const providedKey = req.headers[ADMIN_KEY_HEADER];

    if (typeof providedKey !== "string" || !timingSafeStringEqual(providedKey, expectedKey)) {
        res.status(401).json({
            error: "Unauthorized: valid X-Admin-Api-Key header is required.",
        });
        return;
    }

    next();
}
