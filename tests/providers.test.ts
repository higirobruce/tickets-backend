import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { enabledProviderIds, enabledProviders, getProvider, providersForCurrency, resetProviders } from "../services/providers/registry";

const env = { ...process.env };
beforeEach(() => resetProviders());
afterEach(() => { process.env = { ...env }; resetProviders(); });

describe("provider registry", () => {
  it("defaults to momo when nothing is set", () => {
    delete process.env.PAYMENT_PROVIDERS; delete process.env.PAYMENTS_MODE;
    expect(enabledProviderIds()).toEqual(["momo"]);
  });
  it("PAYMENTS_MODE=mock is an alias for PAYMENT_PROVIDERS=mock", () => {
    delete process.env.PAYMENT_PROVIDERS; process.env.PAYMENTS_MODE = "mock";
    expect(enabledProviderIds()).toEqual(["mock"]);
  });
  it("parses a comma list, trims, lowercases, ignores blanks", () => {
    process.env.PAYMENT_PROVIDERS = " Momo, lumicash ,, ";
    expect(enabledProviderIds()).toEqual(["momo", "lumicash"]);
  });
  it("an unknown provider id throws ProviderConfigError at first use", () => {
    process.env.PAYMENT_PROVIDERS = "paypal";
    expect(() => enabledProviders()).toThrow(/paypal/);
  });
  it("getProvider returns undefined for a provider that is not enabled", () => {
    process.env.PAYMENT_PROVIDERS = "mock";
    expect(getProvider("momo")).toBeUndefined();
    expect(getProvider("mock")?.id).toBe("mock");
  });
  it("providersForCurrency filters by currency; mock accepts any", () => {
    process.env.PAYMENT_PROVIDERS = "mock";
    expect(providersForCurrency("BIF").map((p) => p.id)).toEqual(["mock"]);
  });
});
