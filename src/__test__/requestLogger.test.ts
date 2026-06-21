import { EventEmitter } from "node:events";
import type { Request, Response } from "express";
import { describe, expect, it, vi } from "vitest";

const { infoMock } = vi.hoisted(() => ({
  infoMock: vi.fn(),
}));

vi.mock("../utils/logger.js", () => ({
  logger: {
    info: infoMock,
  },
}));

function createResponse(): Response & EventEmitter {
  const res = new EventEmitter() as Response & EventEmitter;
  res.statusCode = 200;
  res.setHeader = vi.fn();
  return res;
}

describe("requestLogger", () => {
  it("redacts sensitive query values from start and end path logs", async () => {
    infoMock.mockReset();
    const { requestLogger } = await import("../middleware/requestLogger.js");
    const seed = `S${"A".repeat(55)}`;
    const muxed = `M${"B".repeat(68)}`;
    const req = {
      headers: {},
      method: "GET",
      originalUrl: `/api/credit/lines?email=borrower@example.com&seed=${seed}&muxed=${muxed}`,
      body: {},
    } as Request;
    const res = createResponse();
    const next = vi.fn();

    requestLogger(req, res, next);
    res.emit("finish");

    expect(next).toHaveBeenCalledOnce();
    expect(infoMock).toHaveBeenCalledTimes(2);

    const startPayload = infoMock.mock.calls[0]?.[0] as { path: string };
    const endPayload = infoMock.mock.calls[1]?.[0] as { path: string };

    expect(startPayload.path).toContain("[REDACTED_EMAIL]");
    expect(startPayload.path).toContain("[REDACTED_STELLAR_SECRET]");
    expect(startPayload.path).toContain("[REDACTED_MUXED_ACCOUNT]");
    expect(startPayload.path).not.toContain("borrower@example.com");
    expect(startPayload.path).not.toContain(seed);
    expect(startPayload.path).not.toContain(muxed);
    expect(endPayload.path).toBe(startPayload.path);
  });
});
