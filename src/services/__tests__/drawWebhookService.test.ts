import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { 
    initializeWebhooks, 
    sendDrawConfirmationWebhook, 
    testWebhookConnectivity,
    getWebhookConfig,
    resolveWebhookConfig,
} from "../drawWebhookService.js";
import type { HorizonEvent } from "../horizonListener.js";

// Mock fetch globally
const mockFetch = vi.fn();
global.fetch = mockFetch;

// Mock console methods to avoid noise in tests
const mockConsoleError = vi.spyOn(console, "error").mockImplementation(() => {});
const mockConsoleWarn = vi.spyOn(console, "warn").mockImplementation(() => {});
const mockConsoleLog = vi.spyOn(console, "log").mockImplementation(() => {});

describe("DrawWebhookService", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.useFakeTimers();
        
        // Clear environment variables
        delete process.env.WEBHOOK_URLS;
        delete process.env.WEBHOOK_SECRET;
        delete process.env.WEBHOOK_MAX_RETRIES;
        delete process.env.WEBHOOK_INITIAL_BACKOFF_MS;
        delete process.env.WEBHOOK_BACKOFF_MULTIPLIER;
        delete process.env.WEBHOOK_TIMEOUT_MS;
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    describe("resolveWebhookConfig", () => {
        it("should resolve configuration from environment variables", () => {
            process.env.WEBHOOK_URLS = "https://example.com/webhook,https://test.com/hook";
            process.env.WEBHOOK_SECRET = "test-secret";
            process.env.WEBHOOK_MAX_RETRIES = "5";
            process.env.WEBHOOK_INITIAL_BACKOFF_MS = "2000";
            process.env.WEBHOOK_BACKOFF_MULTIPLIER = "3.0";
            process.env.WEBHOOK_TIMEOUT_MS = "15000";

            const config = resolveWebhookConfig();

            expect(config.urls).toEqual([
                "https://example.com/webhook",
                "https://test.com/hook"
            ]);
            expect(config.secret).toBe("test-secret");
            expect(config.maxRetries).toBe(5);
            expect(config.initialBackoffMs).toBe(2000);
            expect(config.backoffMultiplier).toBe(3.0);
            expect(config.timeoutMs).toBe(15000);
        });

        it("should use default values when environment variables are not set", () => {
            process.env.WEBHOOK_SECRET = "required-secret";

            const config = resolveWebhookConfig();

            expect(config.urls).toEqual([]);
            expect(config.secret).toBe("required-secret");
            expect(config.maxRetries).toBe(3);
            expect(config.initialBackoffMs).toBe(1000);
            expect(config.backoffMultiplier).toBe(2.0);
            expect(config.timeoutMs).toBe(10000);
        });

        it("should throw error when URLs are configured but secret is missing", () => {
            process.env.WEBHOOK_URLS = "https://example.com/webhook";
            // WEBHOOK_SECRET is not set

            expect(() => resolveWebhookConfig()).toThrow(
                "WEBHOOK_SECRET is required when WEBHOOK_URLS is configured"
            );
        });

        it("should handle empty URLs gracefully", () => {
            process.env.WEBHOOK_URLS = "";
            process.env.WEBHOOK_SECRET = "secret";

            const config = resolveWebhookConfig();
            expect(config.urls).toEqual([]);
        });

        it("should trim and filter URLs", () => {
            process.env.WEBHOOK_URLS = " https://example.com/webhook , , https://test.com/hook ";
            process.env.WEBHOOK_SECRET = "secret";

            const config = resolveWebhookConfig();
            expect(config.urls).toEqual([
                "https://example.com/webhook",
                "https://test.com/hook"
            ]);
        });
    });

    describe("initializeWebhooks", () => {
        it("should initialize webhooks successfully with valid configuration", () => {
            process.env.WEBHOOK_URLS = "https://example.com/webhook";
            process.env.WEBHOOK_SECRET = "test-secret";

            initializeWebhooks();

            const config = getWebhookConfig();
            expect(config).not.toBeNull();
            expect(config?.urls).toEqual(["https://example.com/webhook"]);
            expect(config?.secret).toBe("test-secret");
        });

        it("should handle missing configuration gracefully", () => {
            initializeWebhooks();

            const config = getWebhookConfig();
            expect(config).not.toBeNull();
            expect(config?.urls).toEqual([]);
        });

        it("should log initialization details", () => {
            process.env.WEBHOOK_URLS = "https://example.com/webhook,https://test.com/hook";
            process.env.WEBHOOK_SECRET = "test-secret";

            initializeWebhooks();

            expect(mockConsoleLog).toHaveBeenCalledWith(
                "[DrawWebhook] Initialized with config:",
                expect.objectContaining({
                    urls: 2,
                    maxRetries: 3,
                    timeoutMs: 10000
                })
            );
        });
    });

    describe("sendDrawConfirmationWebhook", () => {
        beforeEach(() => {
            process.env.WEBHOOK_URLS = "https://example.com/webhook";
            process.env.WEBHOOK_SECRET = "test-secret";
            initializeWebhooks();
        });

        it("should skip webhook delivery when no URLs are configured", async () => {
            delete process.env.WEBHOOK_URLS;
            initializeWebhooks();

            const event: HorizonEvent = {
                ledger: 1000,
                timestamp: "2023-01-01T00:00:00Z",
                contractId: "contract-123",
                topics: ["draw_confirmed"],
                data: JSON.stringify({
                    drawAmount: "1000",
                    drawId: "draw-123",
                    borrowerWallet: "wallet-123",
                    creditLineId: "credit-123"
                })
            };

            await expect(sendDrawConfirmationWebhook(event)).resolves.toEqual([]);
            expect(mockFetch).not.toHaveBeenCalled();
        });

        it("should skip non-draw confirmation events", async () => {
            const event: HorizonEvent = {
                ledger: 1000,
                timestamp: "2023-01-01T00:00:00Z",
                contractId: "contract-123",
                topics: ["other_event"],
                data: JSON.stringify({})
            };

            await expect(sendDrawConfirmationWebhook(event)).resolves.toEqual([]);
            expect(mockFetch).not.toHaveBeenCalled();
        });

        it("should successfully deliver webhook for draw confirmation event", async () => {
            mockFetch.mockResolvedValueOnce({
                ok: true,
                status: 200,
                statusText: "OK"
            });

            const event: HorizonEvent = {
                ledger: 1000,
                timestamp: "2023-01-01T00:00:00Z",
                contractId: "contract-123",
                topics: ["draw_confirmed"],
                data: JSON.stringify({
                    drawAmount: "1000",
                    drawId: "draw-123",
                    borrowerWallet: "wallet-123",
                    creditLineId: "credit-123"
                })
            };

            const results = await sendDrawConfirmationWebhook(event);

            expect(results).toHaveLength(1);
            expect(results[0]).toEqual({
                url: "https://example.com/webhook",
                success: true,
                attempt: 1,
                responseStatus: 200
            });

            expect(mockFetch).toHaveBeenCalledWith(
                "https://example.com/webhook",
                expect.objectContaining({
                    method: "POST",
                    headers: expect.objectContaining({
                        "Content-Type": "application/json",
                        "X-Webhook-Signature": expect.stringMatching(/^sha256=/),
                        "X-Webhook-Timestamp": expect.any(String),
                        "User-Agent": "Creditra-Webhook/1.0"
                    }),
                    body: expect.stringContaining('"event":"draw_confirmed"')
                })
            );
        });

        it("should handle HTTP errors properly", async () => {
            mockFetch.mockResolvedValueOnce({
                ok: false,
                status: 400,
                statusText: "Bad Request"
            });

            const event: HorizonEvent = {
                ledger: 1000,
                timestamp: "2023-01-01T00:00:00Z",
                contractId: "contract-123",
                topics: ["draw_confirmed"],
                data: JSON.stringify({
                    drawAmount: "1000",
                    drawId: "draw-123",
                    borrowerWallet: "wallet-123",
                    creditLineId: "credit-123"
                })
            };

            const results = await sendDrawConfirmationWebhook(event);

            expect(results).toHaveLength(1);
            expect(results[0]).toEqual({
                url: "https://example.com/webhook",
                success: false,
                attempt: 1,
                responseStatus: 400,
                error: "HTTP 400: Bad Request"
            });
        });

        it("should retry failed requests with exponential backoff", async () => {
            mockFetch
                .mockRejectedValueOnce(new Error("Network error"))
                .mockRejectedValueOnce(new Error("Network error"))
                .mockResolvedValueOnce({
                    ok: true,
                    status: 200,
                    statusText: "OK"
                });

            const event: HorizonEvent = {
                ledger: 1000,
                timestamp: "2023-01-01T00:00:00Z",
                contractId: "contract-123",
                topics: ["draw_confirmed"],
                data: JSON.stringify({
                    drawAmount: "1000",
                    drawId: "draw-123",
                    borrowerWallet: "wallet-123",
                    creditLineId: "credit-123"
                })
            };

            const promise = sendDrawConfirmationWebhook(event);
            
            // Advance timers for retries
            await vi.advanceTimersByTimeAsync(1000); // First backoff
            await vi.advanceTimersByTimeAsync(2000); // Second backoff

            const results = await promise;

            expect(results).toHaveLength(1);
            expect(results[0]).toEqual({
                url: "https://example.com/webhook",
                success: true,
                attempt: 3,
                responseStatus: 200
            });

            expect(mockFetch).toHaveBeenCalledTimes(3);
            expect(mockConsoleWarn).toHaveBeenCalledTimes(2);
        });

        it("should handle malformed event data gracefully", async () => {
            const event: HorizonEvent = {
                ledger: 1000,
                timestamp: "2023-01-01T00:00:00Z",
                contractId: "contract-123",
                topics: ["draw_confirmed"],
                data: "invalid-json"
            };

            const results = await sendDrawConfirmationWebhook(event);

            expect(results).toEqual([]);
            expect(mockConsoleError).toHaveBeenCalledWith(
                "[DrawWebhook] Failed to parse event data:",
                expect.any(Error)
            );
        });

        it("should handle multiple webhook URLs", async () => {
            process.env.WEBHOOK_URLS = "https://example.com/webhook,https://test.com/hook";
            initializeWebhooks();

            mockFetch
                .mockResolvedValueOnce({
                    ok: true,
                    status: 200,
                    statusText: "OK"
                })
                .mockResolvedValueOnce({
                    ok: true,
                    status: 200,
                    statusText: "OK"
                });

            const event: HorizonEvent = {
                ledger: 1000,
                timestamp: "2023-01-01T00:00:00Z",
                contractId: "contract-123",
                topics: ["draw_confirmed"],
                data: JSON.stringify({
                    drawAmount: "1000",
                    drawId: "draw-123",
                    borrowerWallet: "wallet-123",
                    creditLineId: "credit-123"
                })
            };

            const results = await sendDrawConfirmationWebhook(event);

            expect(results).toHaveLength(2);
            expect(results[0].url).toBe("https://example.com/webhook");
            expect(results[1].url).toBe("https://test.com/hook");
            expect(results.every(r => r.success)).toBe(true);
        });
    });

    describe("testWebhookConnectivity", () => {
        beforeEach(() => {
            process.env.WEBHOOK_URLS = "https://example.com/webhook,https://test.com/hook";
            process.env.WEBHOOK_SECRET = "test-secret";
            initializeWebhooks();
        });

        it("should test connectivity to all webhook URLs", async () => {
            mockFetch
                .mockResolvedValueOnce({
                    ok: true,
                    status: 200,
                    statusText: "OK"
                })
                .mockResolvedValueOnce({
                    ok: false,
                    status: 500,
                    statusText: "Internal Server Error"
                });

            const results = await testWebhookConnectivity();

            expect(results).toHaveLength(2);
            expect(results[0]).toEqual({
                url: "https://example.com/webhook",
                reachable: true
            });
            expect(results[1]).toEqual({
                url: "https://test.com/hook",
                reachable: false,
                error: "HTTP 500: Internal Server Error"
            });
        });

        it("should handle network errors during connectivity test", async () => {
            mockFetch.mockRejectedValueOnce(new Error("Connection refused"));

            const results = await testWebhookConnectivity();

            expect(results).toHaveLength(2);
            expect(results[0]).toEqual({
                url: "https://example.com/webhook",
                reachable: false,
                error: "Connection refused"
            });
        });

        it("should return empty array when no URLs are configured", async () => {
            delete process.env.WEBHOOK_URLS;
            initializeWebhooks();

            const results = await testWebhookConnectivity();

            expect(results).toEqual([]);
        });
    });

    describe("HMAC Signature Generation", () => {
        it("should generate consistent signatures for the same payload", async () => {
            process.env.WEBHOOK_URLS = "https://example.com/webhook";
            process.env.WEBHOOK_SECRET = "test-secret";
            initializeWebhooks();

            mockFetch.mockResolvedValue({
                ok: true,
                status: 200,
                statusText: "OK"
            });

            const event: HorizonEvent = {
                ledger: 1000,
                timestamp: "2023-01-01T00:00:00Z",
                contractId: "contract-123",
                topics: ["draw_confirmed"],
                data: JSON.stringify({
                    drawAmount: "1000",
                    drawId: "draw-123",
                    borrowerWallet: "wallet-123",
                    creditLineId: "credit-123"
                })
            };

            await sendDrawConfirmationWebhook(event);
            const firstCallSignature = mockFetch.mock.calls[0][1].headers["X-Webhook-Signature"];

            mockFetch.mockClear();
            await sendDrawConfirmationWebhook(event);
            const secondCallSignature = mockFetch.mock.calls[0][1].headers["X-Webhook-Signature"];

            expect(firstCallSignature).toBe(secondCallSignature);
            expect(firstCallSignature).toMatch(/^sha256=[a-f0-9]{64}$/);
        });
    });

    describe("Request Timeout", () => {
        it("should handle request timeouts", async () => {
            process.env.WEBHOOK_URLS = "https://example.com/webhook";
            process.env.WEBHOOK_SECRET = "test-secret";
            process.env.WEBHOOK_TIMEOUT_MS = "1000";
            process.env.WEBHOOK_MAX_RETRIES = "0";
            initializeWebhooks();

            // Mock fetch that never resolves
            mockFetch.mockImplementation(() => new Promise(() => {}));

            const event: HorizonEvent = {
                ledger: 1000,
                timestamp: "2023-01-01T00:00:00Z",
                contractId: "contract-123",
                topics: ["draw_confirmed"],
                data: JSON.stringify({
                    drawAmount: "1000",
                    drawId: "draw-123",
                    borrowerWallet: "wallet-123",
                    creditLineId: "credit-123"
                })
            };

            const promise = sendDrawConfirmationWebhook(event);
            
            // Advance timer past timeout
            await vi.advanceTimersByTimeAsync(1000);

            const results = await promise;

            expect(results).toHaveLength(1);
            expect(results[0]).toEqual({
                url: "https://example.com/webhook",
                success: false,
                attempt: 1,
                error: "Request timeout"
            });
        });
    });
});
