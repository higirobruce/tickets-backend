import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { enabledProviderIds, enabledProviders, getProvider, providersForCurrency, resetProviders } from "../services/providers/registry";
import { fetchMock } from "./setup";

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

describe("mock provider", () => {
  it("mock start is successful at once and its raw payload says mock", async () => {
    process.env.PAYMENT_PROVIDERS = "mock";
    const r = await getProvider("mock")!.start({ refId: "abcdef12-0000", amount: 5000, currency: "RWF", phone: "250788123456", description: "x" });
    expect(r.outcome).toBe("successful");
    expect(r.raw).toMatchObject({ mock: true, status: "SUCCESSFUL", amount: "5000", payer: { partyId: "250788123456" } });
    expect(r.providerRef).toBe("MOCK-abcdef12");
  });
  it("mock status rebuilds the same result from the stored record", async () => {
    process.env.PAYMENT_PROVIDERS = "mock";
    const s = await getProvider("mock")!.status({ refId: "abcdef12-0000", amount: 5000, currency: "BIF", phone: "250788123456" });
    expect(s).toMatchObject({ outcome: "successful", providerRef: "MOCK-abcdef12", amount: 5000, currency: "BIF", payerPhone: "250788123456" });
    expect(s.raw).toMatchObject({ mock: true, amount: "5000", currency: "BIF", financialTransactionId: "MOCK-abcdef12" });
  });
});

const ok = (body: any, status = 200) => ({ ok: status < 400, status, statusText: "OK", json: async () => body });

describe("momo provider", () => {
  it("momo currencies come from MOMO_CURRENCIES, default RWF", () => {
    process.env.PAYMENT_PROVIDERS = "momo"; delete process.env.MOMO_CURRENCIES;
    expect(getProvider("momo")!.currencies).toEqual(["RWF"]);
    resetProviders(); process.env.MOMO_CURRENCIES = "EUR,RWF";
    expect(getProvider("momo")!.currencies).toEqual(["EUR", "RWF"]);
  });
  it("momo start returns pending and registers the /payments/momo/callback URL", async () => {
    process.env.PAYMENT_PROVIDERS = "momo";
    fetchMock.mockResolvedValueOnce(ok({ access_token: "t" })).mockResolvedValueOnce(ok({}, 202));
    const r = await getProvider("momo")!.start({ refId: "ref-1", amount: 5000, currency: "RWF", phone: "250788123456", description: "1 x VIP" });
    expect(r.outcome).toBe("pending");
    const [, init] = fetchMock.mock.calls[1];
    expect(init.headers["X-Callback-Url"]).toBe("http://api.test/payments/momo/callback");
    expect(JSON.parse(init.body)).toMatchObject({ amount: "5000", externalId: "ref-1", payer: { partyId: "250788123456" } });
  });
  it("momo status maps SUCCESSFUL, REJECTED and PENDING", async () => {
    process.env.PAYMENT_PROVIDERS = "momo";
    const p = getProvider("momo")!;
    fetchMock.mockResolvedValueOnce(ok({ access_token: "t" })).mockResolvedValueOnce(ok({ status: "SUCCESSFUL", amount: "5000", currency: "RWF", financialTransactionId: "FT1", payer: { partyId: "250788123456" } }));
    expect(await p.status({ refId: "r" })).toMatchObject({ outcome: "successful", providerRef: "FT1", amount: 5000, payerPhone: "250788123456" });
    fetchMock.mockResolvedValueOnce(ok({ access_token: "t" })).mockResolvedValueOnce(ok({ status: "REJECTED", reason: "PAYER_NOT_FOUND" }));
    expect(await p.status({ refId: "r" })).toMatchObject({ outcome: "failed", reason: "PAYER_NOT_FOUND" });
    fetchMock.mockResolvedValueOnce(ok({ access_token: "t" })).mockResolvedValueOnce(ok({ status: "PENDING" }));
    expect((await p.status({ refId: "r" })).outcome).toBe("pending");
  });
});
