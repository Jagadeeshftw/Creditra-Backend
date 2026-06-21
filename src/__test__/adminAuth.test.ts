import express from "express";
import request from "supertest";
import { adminAuth, ADMIN_KEY_HEADER } from "../middleware/adminAuth.js";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import type { Request, Response } from "express";

const SECRET = "test-admin-secret-key";

function buildApp() {
    const app = express();
    app.use(express.json());
    // A single protected route for testing the middleware
    app.post("/protected", adminAuth, (_req, res) => {
        res.json({ ok: true });
    });
    return app;
}

let originalKey: string | undefined;

beforeEach(() => {
    originalKey = process.env["ADMIN_API_KEY"];
    process.env["ADMIN_API_KEY"] = SECRET;
});

afterEach(() => {
    if (originalKey === undefined) {
        delete process.env["ADMIN_API_KEY"];
    } else {
        process.env["ADMIN_API_KEY"] = originalKey;
    }
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("adminAuth middleware", () => {
    describe("when ADMIN_API_KEY env var is configured", () => {
        it("calls next() and returns 200 when the correct key is supplied", async () => {
            const res = await request(buildApp())
                .post("/protected")
                .set(ADMIN_KEY_HEADER, SECRET);

            expect(res.status).toBe(200);
            expect(res.body).toEqual({ ok: true });
        });

        it("returns 401 when the X-Admin-Api-Key header is missing", async () => {
            const res = await request(buildApp()).post("/protected");

            expect(res.status).toBe(401);
            expect(res.body.error).toContain("Unauthorized");
        });

        it("returns 401 when the header value is wrong", async () => {
            const res = await request(buildApp())
                .post("/protected")
                .set(ADMIN_KEY_HEADER, "wrong-key");

            expect(res.status).toBe(401);
            expect(res.body.error).toContain("Unauthorized");
        });

        it("returns 401 when the header length differs from the configured key", async () => {
            const res = await request(buildApp())
                .post("/protected")
                .set(ADMIN_KEY_HEADER, `${SECRET}-extra`);

            expect(res.status).toBe(401);
            expect(res.body.error).toContain("Unauthorized");
        });

        it("returns 401 when duplicate header values are provided as an array", () => {
            const req = {
                headers: {
                    [ADMIN_KEY_HEADER]: [SECRET],
                },
            } as unknown as Request;
            const res = {
                status: vi.fn().mockReturnThis(),
                json: vi.fn(),
            } as unknown as Response;
            const next = vi.fn();

            adminAuth(req, res, next);

            expect(res.status).toHaveBeenCalledWith(401);
            expect(next).not.toHaveBeenCalled();
        });

        it("returns 401 when the header is an empty string", async () => {
            const res = await request(buildApp())
                .post("/protected")
                .set(ADMIN_KEY_HEADER, "");

            expect(res.status).toBe(401);
        });

        it("returns 401 when the header is close but not equal to the secret", async () => {
            const res = await request(buildApp())
                .post("/protected")
                .set(ADMIN_KEY_HEADER, `${SECRET}-wrong`);

            expect(res.status).toBe(401);
        });

        it("response body includes X-Admin-Api-Key in the error hint", async () => {
            const res = await request(buildApp()).post("/protected");

            expect(res.body.error).toMatch(/X-Admin-Api-Key/);
        });

        it("returns JSON content-type on 401", async () => {
            const res = await request(buildApp()).post("/protected");
            expect(res.headers["content-type"]).toMatch(/application\/json/);
        });
    });

    describe("when ADMIN_API_KEY env var is NOT configured", () => {
        beforeEach(() => {
            delete process.env["ADMIN_API_KEY"];
        });

        it("returns 503 regardless of what header is sent", async () => {
            const res = await request(buildApp())
                .post("/protected")
                .set(ADMIN_KEY_HEADER, "anything");

            expect(res.status).toBe(503);
        });

        it("returns 503 even without a header", async () => {
            const res = await request(buildApp()).post("/protected");
            expect(res.status).toBe(503);
        });

        it("body error mentions admin authentication is not configured", async () => {
            const res = await request(buildApp()).post("/protected");
            expect(res.body.error).toMatch(/not configured/i);
        });

        it("returns JSON content-type on 503", async () => {
            const res = await request(buildApp()).post("/protected");
            expect(res.headers["content-type"]).toMatch(/application\/json/);
        });
    });
});
