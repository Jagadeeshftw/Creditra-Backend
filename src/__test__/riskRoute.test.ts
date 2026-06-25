import express, { type Express } from "express";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { Container } from "../container/Container.js";
import { riskRouter } from "../routes/risk.js";

const VALID_ADDRESS =
  "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";

type ClearableRepository = { clear?: () => void };

function buildApp(): Express {
  const app = express();
  app.use(express.json());
  app.use("/api/risk", riskRouter);
  return app;
}

describe("POST /api/risk/evaluate", () => {
  let app: Express;
  let container: Container;
  let originalService: unknown;

  beforeEach(() => {
    app = buildApp();
    container = Container.getInstance();
    originalService = container.riskEvaluationService;
  });

  afterEach(() => {
    const repository = container.riskEvaluationRepository as ClearableRepository;
    if (typeof repository.clear === "function") {
      repository.clear();
    }
    Reflect.set(container, "_riskEvaluationService", originalService);
  });

  it("returns 400 when body is empty", async () => {
    const res = await request(app)
      .post("/api/risk/evaluate")
      .set("Content-Type", "application/json")
      .send({});

    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({
      data: null,
      error: "Validation failed",
    });
    expect(res.body.details[0].field).toBe("walletAddress");
  });

  it("returns 400 when walletAddress is blank", async () => {
    const res = await request(app)
      .post("/api/risk/evaluate")
      .send({ walletAddress: "   " });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe("Validation failed");
  });

  it("returns 400 for invalid format without echoing the invalid value", async () => {
    const invalidAddress = "BAD";
    const res = await request(app)
      .post("/api/risk/evaluate")
      .send({ walletAddress: invalidAddress });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe("Validation failed");
    expect(JSON.stringify(res.body)).not.toContain(invalidAddress);
  });

  it("returns an enveloped service result on a valid address", async () => {
    const res = await request(app)
      .post("/api/risk/evaluate")
      .send({ walletAddress: VALID_ADDRESS });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      data: {
        walletAddress: VALID_ADDRESS,
        message: "New risk evaluation completed",
      },
      error: null,
    });
  });

  it("returns 500 with a generic message when the service throws unexpectedly", async () => {
    Reflect.set(container, "_riskEvaluationService", {
      evaluateRisk: async () => {
        throw new Error("DB unavailable");
      },
    });

    const res = await request(app)
      .post("/api/risk/evaluate")
      .send({ walletAddress: VALID_ADDRESS });

    expect(res.status).toBe(500);
    expect(res.body).toEqual({
      data: null,
      error: "Internal server error",
    });
  });

  it("returns JSON content-type on 400 error", async () => {
    const res = await request(app).post("/api/risk/evaluate").send({});
    expect(res.headers["content-type"]).toMatch(/application\/json/);
  });
});
