import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { sign, formatSignDate, formatBodyDate, formatTransDate, formatAmount, toRequestId, customerMobile } from "../services/providers/lumicashSign";
import { getProvider, resetProviders } from "../services/providers/registry";
import { fetchMock } from "./setup";
import { LUMI_ENV } from "./lumicashEnv";

const ok = (body: any) => ({ ok: true, status: 200, statusText: "OK", json: async () => body });
const env = { ...process.env };
beforeEach(() => { Object.assign(process.env, LUMI_ENV); resetProviders(); });
afterEach(() => { process.env = { ...env }; resetProviders(); });

describe("lumicash signing", () => {
  it("formats the signature date in Bujumbura time", () => {
    expect(formatSignDate(new Date("2026-11-02T10:00:00Z"))).toBe("20261102120000");
    expect(formatTransDate(new Date("2026-11-02T22:30:00Z"))).toBe("20261103");
    expect(formatBodyDate(new Date(1664520885000))).toBe("/Date(1664520885000+0200)/");
    expect(formatAmount(5000)).toBe("5000"); expect(formatAmount(1000.0)).toBe("1000");
  });
  it("reproduces a hand-computed MD5", () => {
    // md5("secret" + "20261102120000" + "5000" + "25768191919" + "89503" + "EVENTIXR" + "1" + "abc123")
    expect(sign({ key: "secret", createdAt: new Date("2026-11-02T10:00:00Z"), amount: 5000, customerMobile: "25768191919", agentCode: "89503", partner: "EVENTIXR", requestType: 1, requestId: "abc123" }))
      .toBe("d8e9ab2627e1283d1a5adbec3cf397ec");
  });
  it("request id drops hyphens; mobile gains 257 unless LUMICASH_MSISDN_FORMAT=local", () => {
    expect(toRequestId("3f2a-77")).toBe("3f2a77");
    expect(customerMobile("68191919")).toBe("25768191919");
    expect(customerMobile("25768191919")).toBe("25768191919");
    process.env.LUMICASH_MSISDN_FORMAT = "local";
    expect(customerMobile("68191919")).toBe("68191919");
    expect(customerMobile("25768191919")).toBe("68191919");
  });
});

describe("lumicash provider", () => {
  it("fails fast when a required env value is missing", () => {
    delete process.env.LUMICASH_SIGN_KEY; resetProviders();
    expect(() => getProvider("lumicash")).toThrow(/LUMICASH_SIGN_KEY/);
  });
  it("lookup returns the holder name on 01 and a reason on 05", async () => {
    const p = getProvider("lumicash")!;
    fetchMock.mockResolvedValueOnce(ok({ ResponseCode: "01", ResponseMessage: JSON.stringify({ accountName: "Bui Duc Truyen", accountId: "1" }) }));
    expect(await p.lookup!("68191919")).toEqual({ ok: true, name: "Bui Duc Truyen" });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("http://lumi.test/ewapi/api/3rd/partner/get-account");
    expect(init.headers.Authorization).toBe("Basic " + Buffer.from("u:p").toString("base64"));
    expect(JSON.parse(init.body)).toEqual({ toAccPhone: "25768191919" });
    fetchMock.mockResolvedValueOnce(ok({ ResponseCode: "05", ResponseMessage: "locked" }));
    expect(await p.lookup!("68191919")).toEqual({ ok: false, reason: "Wallet not found or locked" });
  });
  it("start sends a signed cashout and maps 01 to successful", async () => {
    fetchMock.mockResolvedValueOnce(ok({ ResponseCode: "01", ResponseMessage: "Transaction successful", RequestId: "22010512947928" }));
    const r = await getProvider("lumicash")!.start({ refId: "3f2a-77", amount: 7000, currency: "BIF", phone: "68191919", description: "1 x VIP" });
    expect(r).toMatchObject({ outcome: "successful", providerRef: "22010512947928", amount: 7000, currency: "BIF", payerPhone: "25768191919" });
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body).toMatchObject({ Partner: "EVENTIXR", RequestId: "3f2a77", CustomerMobile: "25768191919", AgentMobile: "25762479782", AgentCode: "89503", Password: "agent-pw", Amount: 7000, RequestType: 1 });
    expect(body.Signature).toMatch(/^[0-9a-f]{32}$/);
    expect(body.CreatedDate).toMatch(/^\/Date\(\d+\+0200\)\/$/);
    expect(JSON.stringify(r.raw)).not.toContain("agent-pw"); expect(JSON.stringify(r.raw)).not.toContain("secret");
  });
  it("maps 10, 03, 02, 25 and 00 to failed with the spec's reasons", async () => {
    const p = getProvider("lumicash")!; const go = () => p.start({ refId: "x", amount: 1, currency: "BIF", phone: "68191919", description: "" });
    for (const [code, reason] of [["10", "Insufficient balance"], ["03", "Wallet not found or locked"], ["02", "Lumicash rejected the signature"], ["25", "Over the wallet's limit"], ["00", "Lumicash error"]]) {
      fetchMock.mockResolvedValueOnce(ok({ ResponseCode: code, ResponseMessage: "m" }));
      expect(await go()).toMatchObject({ outcome: "failed", reason });
    }
  });
  it("a network error leaves the payment pending, never retries", async () => {
    fetchMock.mockRejectedValueOnce(new Error("ETIMEDOUT"));
    const r = await getProvider("lumicash")!.start({ refId: "x", amount: 1, currency: "BIF", phone: "68191919", description: "" });
    expect(r.outcome).toBe("pending"); expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  it("status verifies with TransDate from the stored created date and maps Status 01", async () => {
    const p = getProvider("lumicash")!;
    fetchMock.mockResolvedValueOnce(ok({ ResponseCode: "01", ResponseMessage: "Transaction is Successful", Status: "01", TransCode: "2628", TransAmount: 7000, TransFee: 50 }));
    const r = await p.status({ refId: "3f2a-77", providerRef: "2628", phone: "25768191919", momoPayload: { createdDate: "2026-11-02T22:30:00.000Z", requestId: "3f2a77" } });
    expect(r).toMatchObject({ outcome: "successful", providerRef: "2628", amount: 7000 });
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ RequestId: "3f2a77", PartnerCode: "EVENTIXR", TransCode: "2628", ServiceId: "CHECK_TRANSATION", TransDate: "20261103", Type: "1" });
    fetchMock.mockResolvedValueOnce(ok({ ResponseCode: "01", Status: "02", ResponseMessage: "Failed" }));
    expect((await p.status({ refId: "x", momoPayload: {} })).outcome).toBe("failed");
    fetchMock.mockResolvedValueOnce(ok({ ResponseCode: "999" }));
    expect((await p.status({ refId: "x", momoPayload: {} })).outcome).toBe("pending");
  });
  it("status keeps the stored created date and request id in raw on every branch", async () => {
    const p = getProvider("lumicash")!;
    const stored = { createdDate: "2026-11-02T22:30:00.000Z", requestId: "3f2a77" };
    const payment = { refId: "3f2a-77", amount: 7000, momoPayload: stored };
    fetchMock.mockResolvedValueOnce(ok({ ResponseCode: "999" }));
    const pending = await p.status(payment);
    expect(pending.outcome).toBe("pending"); expect(pending.raw).toMatchObject(stored);
    fetchMock.mockResolvedValueOnce(ok({ ResponseCode: "01", Status: "02", ResponseMessage: "Failed" }));
    const failed = await p.status(payment);
    expect(failed).toMatchObject({ outcome: "failed", reason: "Failed" }); expect(failed.raw).toMatchObject(stored);
    fetchMock.mockRejectedValueOnce(new Error("ETIMEDOUT"));
    const errored = await p.status(payment);
    expect(errored.outcome).toBe("pending"); expect(errored.raw).toMatchObject(stored);
  });
  it("status success falls back to the stored amount and ref when Lumicash omits them", async () => {
    fetchMock.mockResolvedValueOnce(ok({ ResponseCode: "01", Status: "01" }));
    const r = await getProvider("lumicash")!.status({ refId: "3f2a-77", amount: 7000, momoPayload: { requestId: "3f2a77" } });
    expect(r).toMatchObject({ outcome: "successful", amount: 7000, providerRef: "3f2a77" });
  });
  it("start leaves unknown outcomes pending and calls Lumicash once", async () => {
    const p = getProvider("lumicash")!; const go = () => p.start({ refId: "x", amount: 1, currency: "BIF", phone: "68191919", description: "" });
    fetchMock.mockResolvedValueOnce({ ok: false, status: 502, statusText: "Bad Gateway", json: async () => ({ Message: "An error has occurred." }) });
    const bad = await go();
    expect(bad.outcome).toBe("pending"); expect(bad.raw.httpStatus).toBe(502); expect(fetchMock).toHaveBeenCalledTimes(1);
    fetchMock.mockResolvedValueOnce(ok({ ResponseCode: "77" }));
    expect((await go()).outcome).toBe("pending");
    fetchMock.mockResolvedValueOnce({ ok: true, status: 200, statusText: "OK", json: async () => { throw new SyntaxError("Unexpected token <"); } });
    expect((await go()).outcome).toBe("pending");
    fetchMock.mockResolvedValueOnce(ok({ ResponseMessage: "no code" }));
    expect((await go()).outcome).toBe("pending");
    fetchMock.mockResolvedValueOnce(ok({ ResponseCode: "00", ResponseMessage: "m" }));
    expect(await go()).toMatchObject({ outcome: "failed", reason: "Lumicash error" });
    expect(fetchMock).toHaveBeenCalledTimes(5);
  });
  it("start signs and sends the same rounded integer amount", async () => {
    fetchMock.mockResolvedValueOnce(ok({ ResponseCode: "01", RequestId: "1" }));
    await getProvider("lumicash")!.start({ refId: "x", amount: 7000.4, currency: "BIF", phone: "68191919", description: "" });
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.Amount).toBe(7000);
    const createdAt = new Date(Number(/\((\d+)/.exec(body.CreatedDate)![1]));
    expect(body.Signature).toBe(sign({ key: "secret", createdAt, amount: 7000, customerMobile: "25768191919", agentCode: "89503", partner: "EVENTIXR", requestType: 1, requestId: "x" }));
  });
});
