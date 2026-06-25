import { describe, it, expect, afterEach } from "vitest";
import { createRiskProvider } from "../providerFactory.js";
import { StaticRiskProvider } from "../StaticRiskProvider.js";
import { RulesEngineRiskProvider } from "../RulesEngineRiskProvider.js";
import { ExternalApiRiskProvider } from "../ExternalApiRiskProvider.js";

describe("createRiskProvider", () => {
  afterEach(() => {
    delete process.env["RISK_PROVIDER"];
    delete process.env["RISK_PROVIDER_API_URL"];
    delete process.env["RISK_PROVIDER_API_KEY"];
  });

  it("returns RulesEngineRiskProvider by default", () => {
    const provider = createRiskProvider();
    expect(provider).toBeInstanceOf(RulesEngineRiskProvider);
  });

  it('returns StaticRiskProvider when override is "static"', () => {
    const provider = createRiskProvider("static");
    expect(provider).toBeInstanceOf(StaticRiskProvider);
  });

  it('returns RulesEngineRiskProvider when override is "rules"', () => {
    const provider = createRiskProvider("rules");
    expect(provider).toBeInstanceOf(RulesEngineRiskProvider);
  });

  it("reads RISK_PROVIDER env var when no override given", () => {
    process.env["RISK_PROVIDER"] = "static";
    const provider = createRiskProvider();
    expect(provider).toBeInstanceOf(StaticRiskProvider);
  });

  it("override takes precedence over RISK_PROVIDER env var", () => {
    process.env["RISK_PROVIDER"] = "static";
    const provider = createRiskProvider("rules");
    expect(provider).toBeInstanceOf(RulesEngineRiskProvider);
  });

  it('returns ExternalApiRiskProvider when override is "external" with env config', () => {
    process.env["RISK_PROVIDER_API_URL"] = "https://risk.example.com";
    process.env["RISK_PROVIDER_API_KEY"] = "test-key";
    const provider = createRiskProvider("external");
    expect(provider).toBeInstanceOf(ExternalApiRiskProvider);
  });

  it("falls back to RulesEngineRiskProvider for unknown env value", () => {
    process.env["RISK_PROVIDER"] = "unknown_provider";
    const provider = createRiskProvider();
    expect(provider).toBeInstanceOf(RulesEngineRiskProvider);
  });
});
