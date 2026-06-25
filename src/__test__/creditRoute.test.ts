
import express, { type Express, type Response as ExpressResponse } from "express";
import request from "supertest";
import {
  _resetStore,
  createCreditLine,
  suspendCreditLine,
  closeCreditLine,
} from "../services/creditService.js";
import { TransactionType } from "../models/Transaction.js";
import { Container } from "../container/Container.js";

// Mock adminAuth so we can control auth pass/fail from within tests
vi.mock("../middleware/adminAuth.js", () => ({
  adminAuth: vi.fn((_req: unknown, _res: unknown, next: () => void) => next()),
  ADMIN_KEY_HEADER: "x-admin-api-key",
}));

import creditRouter from "../routes/credit.js";
import { adminAuth } from "../middleware/adminAuth.js";
import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";

const mockAdminAuth = vi.mocked(adminAuth);

function buildApp(): Express {
  const app = express();
  app.use(express.json());
  app.use("/api/credit", creditRouter);
  return app;
}

const VALID_ID = "line-abc";
const MISSING_ID = "does-not-exist";
const ADMIN_KEY = "test-secret";

function allowAdmin() {
  mockAdminAuth.mockImplementation((_req, _res, next) => next());
}

function denyAdmin() {
  mockAdminAuth.mockImplementation((_req, res: ExpressResponse, _next) => {
    res.status(401).json({ error: "Unauthorized: valid X-Admin-Api-Key header is required." });
  });
}


beforeEach(() => {
  _resetStore();
  const repository = Container.getInstance().creditLineRepository;
  if ('clear' in repository && typeof repository.clear === 'function') {
    repository.clear();
  }
  allowAdmin(); // default to allowing admin access, override in specific tests as needed
});

afterEach(() => {
  mockAdminAuth.mockReset();
});


describe("GET /api/credit/lines", () => {
  it("returns 200 with an empty array when store is empty", async () => {
    const res = await request(buildApp()).get("/api/credit/lines");
    expect(res.status).toBe(200);
    expect(res.body.data.creditLines).toEqual([]);
  });

  it("returns all credit lines", async () => {
    await Container.getInstance().creditLineService.createCreditLine({
      walletAddress: "wallet-a",
      creditLimit: "1000.00",
      interestRateBps: 500,
    });
    await Container.getInstance().creditLineService.createCreditLine({
      walletAddress: "wallet-b",
      creditLimit: "2000.00",
      interestRateBps: 600,
    });
    const res = await request(buildApp()).get("/api/credit/lines");
    expect(res.body.data.creditLines).toHaveLength(2);
  });

  it("returns JSON content-type", async () => {
    const res = await request(buildApp()).get("/api/credit/lines");
    expect(res.headers["content-type"]).toMatch(/application\/json/);
  });
});


describe("GET /api/credit/lines/:id", () => {
  it("returns 200 with the credit line for a known id", async () => {
    const created = await Container.getInstance().creditLineService.createCreditLine({
      walletAddress: "wallet-c",
      creditLimit: "1000.00",
      interestRateBps: 500,
    });
    const res = await request(buildApp()).get(`/api/credit/lines/${created.id}`);
    expect(res.status).toBe(200);
    expect(res.body.data.id).toBe(created.id);
  });

  it("returns 404 for an unknown id", async () => {
    const res = await request(buildApp()).get(`/api/credit/lines/${MISSING_ID}`);
    expect(res.status).toBe(404);
    expect(res.body.error).toBe("Credit line not found");
  });

  it("returns JSON content-type on 404", async () => {
    const res = await request(buildApp()).get(`/api/credit/lines/${MISSING_ID}`);
    expect(res.headers["content-type"]).toMatch(/application\/json/);
  });
});

describe("POST /api/credit/lines/:id/suspend — authorization", () => {
  it("returns 401 when admin auth is denied", async () => {
    denyAdmin();
    createCreditLine(VALID_ID);
    const res = await request(buildApp())
      .post(`/api/credit/lines/${VALID_ID}/suspend`);
    expect(res.status).toBe(401);
  });

  it("does not suspend the line when auth is denied", async () => {
    denyAdmin();
    createCreditLine(VALID_ID);
    await request(buildApp()).post(`/api/credit/lines/${VALID_ID}/suspend`);
    const { _store } = await import("../services/creditService.js");
    expect(_store.get(VALID_ID)?.status).toBe("active");
  });
});

describe("POST /api/credit/lines/:id/suspend — business logic", () => {
  it("returns 200 and suspended line for an active credit line", async () => {
    createCreditLine(VALID_ID);
    const res = await request(buildApp())
      .post(`/api/credit/lines/${VALID_ID}/suspend`)
      .set("x-admin-api-key", ADMIN_KEY);

    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe("suspended");
    expect(res.body.message).toBe("Credit line suspended.");
  });

  it("response includes the full credit line object", async () => {
    createCreditLine(VALID_ID);
    const res = await request(buildApp())
      .post(`/api/credit/lines/${VALID_ID}/suspend`)
      .set("x-admin-api-key", ADMIN_KEY);

    expect(res.body.data).toMatchObject({
      id: VALID_ID,
      status: "suspended",
    });
    expect(res.body.data.events).toBeDefined();
  });

  it("returns 404 when the credit line does not exist", async () => {
    const res = await request(buildApp())
      .post(`/api/credit/lines/${MISSING_ID}/suspend`)
      .set("x-admin-api-key", ADMIN_KEY);

    expect(res.status).toBe(404);
    expect(res.body.error).toContain(MISSING_ID);
  });

  it("returns 409 when the line is already suspended", async () => {
    createCreditLine(VALID_ID, "suspended");
    const res = await request(buildApp())
      .post(`/api/credit/lines/${VALID_ID}/suspend`)
      .set("x-admin-api-key", ADMIN_KEY);

    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/suspend.*suspended|suspended.*suspend/i);
  });

  it("returns 409 when the line is already closed", async () => {
    createCreditLine(VALID_ID, "closed");
    const res = await request(buildApp())
      .post(`/api/credit/lines/${VALID_ID}/suspend`)
      .set("x-admin-api-key", ADMIN_KEY);

    expect(res.status).toBe(409);
  });
});

describe("POST /api/credit/lines/:id/close — authorization", () => {
  it("returns 401 when admin auth is denied", async () => {
    denyAdmin();
    createCreditLine(VALID_ID);
    const res = await request(buildApp())
      .post(`/api/credit/lines/${VALID_ID}/close`);
    expect(res.status).toBe(401);
  });

  it("does not close the line when auth is denied", async () => {
    denyAdmin();
    createCreditLine(VALID_ID);
    await request(buildApp()).post(`/api/credit/lines/${VALID_ID}/close`);
    const { _store } = await import("../services/creditService.js");
    expect(_store.get(VALID_ID)?.status).toBe("active");
  });
});

describe("POST /api/credit/lines/:id/close — business logic", () => {
  it("returns 200 and closed line for an active credit line", async () => {
    createCreditLine(VALID_ID);
    const res = await request(buildApp())
      .post(`/api/credit/lines/${VALID_ID}/close`)
      .set("x-admin-api-key", ADMIN_KEY);

    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe("closed");
    expect(res.body.message).toBe("Credit line closed.");
  });

  it("returns 200 and closed line for a suspended credit line", async () => {
    createCreditLine(VALID_ID, "suspended");
    const res = await request(buildApp())
      .post(`/api/credit/lines/${VALID_ID}/close`)
      .set("x-admin-api-key", ADMIN_KEY);

    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe("closed");
  });

  it("response includes the full credit line object with events", async () => {
    createCreditLine(VALID_ID);
    const res = await request(buildApp())
      .post(`/api/credit/lines/${VALID_ID}/close`)
      .set("x-admin-api-key", ADMIN_KEY);

    expect(res.body.data.events).toBeDefined();
    expect(res.body.data.events.at(-1).action).toBe("closed");
  });

  it("returns 404 when the credit line does not exist", async () => {
    const res = await request(buildApp())
      .post(`/api/credit/lines/${MISSING_ID}/close`)
      .set("x-admin-api-key", ADMIN_KEY);

    expect(res.status).toBe(404);
    expect(res.body.error).toContain(MISSING_ID);
  });

  it("returns 409 when the line is already closed", async () => {
    createCreditLine(VALID_ID, "closed");
    const res = await request(buildApp())
      .post(`/api/credit/lines/${VALID_ID}/close`)
      .set("x-admin-api-key", ADMIN_KEY);

    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/close.*closed|closed.*close/i);
  });

  it("full lifecycle: active → suspend → close via HTTP", async () => {
    createCreditLine(VALID_ID);
    const app = buildApp();

    await request(app)
      .post(`/api/credit/lines/${VALID_ID}/suspend`)
      .set("x-admin-api-key", ADMIN_KEY);

    const res = await request(app)
      .post(`/api/credit/lines/${VALID_ID}/close`)
      .set("x-admin-api-key", ADMIN_KEY);

    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe("closed");
    expect(res.body.data.events.map((e: { action: string }) => e.action)).toContain("suspended");
  });
});


describe("GET /api/credit/lines/:id/transactions", () => {
  it("returns 200 with the response envelope", async () => {
    createCreditLine(VALID_ID);
    const res = await request(buildApp()).get(`/api/credit/lines/${VALID_ID}/transactions`);
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("data");
    expect(res.body.error).toBeNull();
  });

  it("returns pagination metadata in the response", async () => {
    createCreditLine(VALID_ID);
    const res = await request(buildApp()).get(`/api/credit/lines/${VALID_ID}/transactions`);
    expect(res.body.data).toMatchObject({
      transactions: expect.any(Array),
      total: expect.any(Number),
      page: 1,
      limit: 20,
      totalPages: expect.any(Number),
    });
  });

  it("returns the status_change transaction recorded on line creation", async () => {
    createCreditLine(VALID_ID);
    const res = await request(buildApp()).get(`/api/credit/lines/${VALID_ID}/transactions`);
    expect(res.body.data.transactions).toHaveLength(1);
    expect(res.body.data.transactions[0].type).toBe(TransactionType.STATUS_CHANGE);
    expect(res.body.data.transactions[0].metadata.action).toBe("created");
  });

  it("returns populated history after suspend and close via service", async () => {
    createCreditLine(VALID_ID);
    suspendCreditLine(VALID_ID);
    closeCreditLine(VALID_ID);
    const res = await request(buildApp()).get(`/api/credit/lines/${VALID_ID}/transactions`);
    expect(res.body.data.total).toBe(3);
    expect(res.body.data.transactions).toHaveLength(3);
    expect(res.body.data.transactions.map((tx: { metadata: { action: string } }) => tx.metadata.action)).toEqual([
      "closed",
      "suspended",
      "created",
    ]);
  });

  it("returns 404 with error containing id for an unknown credit line", async () => {
    const res = await request(buildApp()).get(`/api/credit/lines/${MISSING_ID}/transactions`);
    expect(res.status).toBe(404);
    expect(res.body.error).toContain(MISSING_ID);
  });

  it("returns 404 with JSON content-type", async () => {
    const res = await request(buildApp()).get(`/api/credit/lines/${MISSING_ID}/transactions`);
    expect(res.headers["content-type"]).toMatch(/application\/json/);
  });

  it("filters by type=status_change", async () => {
    createCreditLine(VALID_ID);
    suspendCreditLine(VALID_ID);
    const res = await request(buildApp()).get(
      `/api/credit/lines/${VALID_ID}/transactions?type=${TransactionType.STATUS_CHANGE}`,
    );
    expect(res.status).toBe(200);
    expect(
      res.body.data.transactions.every(
        (tx: { type: string }) => tx.type === TransactionType.STATUS_CHANGE,
      ),
    ).toBe(true);
  });

  it("returns empty transactions array when type filter has no matches", async () => {
    createCreditLine(VALID_ID);
    const res = await request(buildApp()).get(
      `/api/credit/lines/${VALID_ID}/transactions?type=${TransactionType.BORROW}`,
    );
    expect(res.status).toBe(200);
    expect(res.body.data.transactions).toHaveLength(0);
    expect(res.body.data.total).toBe(0);
  });

  it("returns 400 for an invalid type filter value", async () => {
    createCreditLine(VALID_ID);
    const res = await request(buildApp()).get(
      `/api/credit/lines/${VALID_ID}/transactions?type=invalid`,
    );
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/type/i);
  });

  it("returns 400 for an invalid 'from' date", async () => {
    createCreditLine(VALID_ID);
    const res = await request(buildApp()).get(
      `/api/credit/lines/${VALID_ID}/transactions?from=not-a-date`,
    );
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/from/i);
  });

  it("returns 400 for an invalid 'to' date", async () => {
    createCreditLine(VALID_ID);
    const res = await request(buildApp()).get(
      `/api/credit/lines/${VALID_ID}/transactions?to=not-a-date`,
    );
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/to/i);
  });

  it("returns 400 for a non-numeric 'page' value", async () => {
    createCreditLine(VALID_ID);
    const res = await request(buildApp()).get(
      `/api/credit/lines/${VALID_ID}/transactions?page=abc`,
    );
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/page/i);
  });

  it("returns 400 for page=0", async () => {
    createCreditLine(VALID_ID);
    const res = await request(buildApp()).get(
      `/api/credit/lines/${VALID_ID}/transactions?page=0`,
    );
    expect(res.status).toBe(400);
  });

  it("returns 400 for a non-numeric 'limit' value", async () => {
    createCreditLine(VALID_ID);
    const res = await request(buildApp()).get(
      `/api/credit/lines/${VALID_ID}/transactions?limit=xyz`,
    );
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/limit/i);
  });

  it("returns 400 for limit=0", async () => {
    createCreditLine(VALID_ID);
    const res = await request(buildApp()).get(
      `/api/credit/lines/${VALID_ID}/transactions?limit=0`,
    );
    expect(res.status).toBe(400);
  });

  it("returns 400 for limit exceeding 100", async () => {
    createCreditLine(VALID_ID);
    const res = await request(buildApp()).get(
      `/api/credit/lines/${VALID_ID}/transactions?limit=101`,
    );
    expect(res.status).toBe(400);
  });

  it("respects custom page and limit query params", async () => {
    createCreditLine(VALID_ID);
    suspendCreditLine(VALID_ID);
    closeCreditLine(VALID_ID);
    const res = await request(buildApp()).get(
      `/api/credit/lines/${VALID_ID}/transactions?page=1&limit=2`,
    );
    expect(res.status).toBe(200);
    expect(res.body.data.transactions).toHaveLength(2);
    expect(res.body.data.total).toBe(3);
    expect(res.body.data.totalPages).toBe(2);
    expect(res.body.data.limit).toBe(2);
  });

  it("returns second page of results correctly", async () => {
    createCreditLine(VALID_ID);
    suspendCreditLine(VALID_ID);
    closeCreditLine(VALID_ID);
    const res = await request(buildApp()).get(
      `/api/credit/lines/${VALID_ID}/transactions?page=2&limit=2`,
    );
    expect(res.status).toBe(200);
    expect(res.body.data.transactions).toHaveLength(1);
    expect(res.body.data.transactions[0].metadata.action).toBe("created");
  });

  it("filters by valid 'from' date excluding older transactions", async () => {
    createCreditLine(VALID_ID);
    const future = new Date(Date.now() + 60_000).toISOString();
    const res = await request(buildApp()).get(
      `/api/credit/lines/${VALID_ID}/transactions?from=${encodeURIComponent(future)}`,
    );
    expect(res.status).toBe(200);
    expect(res.body.data.transactions).toHaveLength(0);
  });

  it("filters by valid 'to' date excluding newer transactions", async () => {
    createCreditLine(VALID_ID);
    const past = new Date(Date.now() - 60_000).toISOString();
    const res = await request(buildApp()).get(
      `/api/credit/lines/${VALID_ID}/transactions?to=${encodeURIComponent(past)}`,
    );
    expect(res.status).toBe(200);
    expect(res.body.data.transactions).toHaveLength(0);
  });
});
