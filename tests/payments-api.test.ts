import { describe, it, expect, vi, afterEach } from "vitest";
import { settlePayment } from "../services/payments";
import { paymentModel } from "../models/payments";
import { ticketModel } from "../models/tickets";
import { eventModel } from "../models/events";
import { resetProviders } from "../services/providers/registry";
import { api, seedEvent } from "./helpers";
import { fetchMock } from "./setup";
import { LUMI_ENV } from "./lumicashEnv";
vi.mock("../services/sms", () => ({ default: vi.fn() }));

describe("settlePayment with a normalised result", () => {
  it("successful issues once and stores the payment block on the ticket", async () => {
    const event = await seedEvent();
    const p = await paymentModel.create({ refId: "r1", provider: "lumicash", amount: 7000, currency: "BIF", phone: "25768191919", event: event._id, ticketPackage: event.packages[0], quantity: 1 });
    const first = await settlePayment(p, { outcome: "successful", providerRef: "LC-1", raw: { ResponseCode: "01" } });
    expect(first.code).toBe(200); expect(first.body.status).toBe("SUCCESSFUL"); expect(first.body.tickets).toHaveLength(1);
    const again = await settlePayment(await paymentModel.findOne({ refId: "r1" }), { outcome: "successful", providerRef: "LC-1", raw: {} });
    expect(again.body.tickets).toHaveLength(1);
    expect(await ticketModel.countDocuments()).toBe(1);
    const t: any = await ticketModel.findOne();
    expect(t.payment).toMatchObject({ provider: "lumicash", ref: "LC-1", amount: 7000, currency: "BIF", phone: "25768191919" });
    expect((await paymentModel.findOne({ refId: "r1" }))!.providerRef).toBe("LC-1");
  });
  it("failed marks the record FAILED with the reason and releases seats", async () => {
    const event = await seedEvent({ packages: [{ title: "Regular", price: 5000, currency: "RWF", capacity: 2, sold: 1 }] });
    const pkg: any = event.packages[0];
    const p = await paymentModel.create({ refId: "r2", provider: "lumicash", event: event._id, ticketPackage: pkg, quantity: 1, reserved: true });
    const r = await settlePayment(p, { outcome: "failed", reason: "Insufficient balance", raw: { ResponseCode: "10" } });
    expect(r.body).toMatchObject({ status: "FAILED", reason: "Insufficient balance" });
    expect((await paymentModel.findOne({ refId: "r2" }))!.status).toBe("FAILED");
    expect((await ticketModel.countDocuments())).toBe(0);
    const fresh: any = await (await import("../models/events")).eventModel.findById(event._id);
    expect(fresh.packages[0].sold).toBe(0);
  });
  it("pending stores the raw payload and issues nothing", async () => {
    const p = await paymentModel.create({ refId: "r3", provider: "momo" });
    const r = await settlePayment(p, { outcome: "pending", raw: { status: "PENDING" } });
    expect(r.body.status).toBe("PENDING");
    expect(await ticketModel.countDocuments()).toBe(0);
  });
});

const ok = (body: any, status = 200) => ({ ok: status < 400, status, statusText: "OK", json: async () => body });
const envSnap = { ...process.env };
afterEach(() => { process.env = { ...envSnap }; resetProviders(); });

describe("POST /payments/start", () => {
  const bif = () => seedEvent({ title: "Bujumbura Live", packages: [{ title: "VIP", price: 7000, currency: "BIF", capacity: 5 }] });
  const lumiOk = (body: any) => fetchMock.mockResolvedValueOnce({ ok: true, status: 200, statusText: "OK", json: async () => body });

  it("lists only enabled providers", async () => {
    process.env.PAYMENT_PROVIDERS = "mock"; resetProviders();
    const res = await api().get("/payments/providers");
    expect(res.body).toEqual([{ id: "mock", label: "Test mode", currencies: [], phone: { countryCode: "250", pattern: "^7\\d{8}$", hint: expect.any(String) } }]);
  });
  it("charges the stored price, not the client's, and completes a Lumicash sale at once", async () => {
    Object.assign(process.env, LUMI_ENV); resetProviders();
    const event = await bif(); const pkg: any = event.packages[0];
    lumiOk({ ResponseCode: "01", RequestId: "LC1" });
    const res = await api().post("/payments/start").send({ provider: "lumicash", eventId: String(event._id), packageId: String(pkg._id), quantity: 2, phone: "68191919", price: 1 });
    expect(res.status).toBe(200); expect(res.body.status).toBe("SUCCESSFUL"); expect(res.body.tickets).toHaveLength(2);
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).Amount).toBe(14000);
    const t: any = await ticketModel.findOne();
    expect(t.payment).toMatchObject({ provider: "lumicash", amount: 14000, currency: "BIF", phone: "25768191919", ref: "LC1" });
  });
  it("a failed cashout answers 402 with the reason and frees the seats", async () => {
    Object.assign(process.env, LUMI_ENV); resetProviders();
    const event = await bif(); const pkg: any = event.packages[0];
    lumiOk({ ResponseCode: "10" });
    const res = await api().post("/payments/start").send({ provider: "lumicash", eventId: String(event._id), packageId: String(pkg._id), quantity: 1, phone: "68191919" });
    expect(res.status).toBe(402); expect(res.body).toMatchObject({ status: "FAILED", reason: "Insufficient balance" });
    expect((await eventModel.findById(event._id))!.packages[0].sold).toBe(0);
  });
  it("rejects a disabled provider, a currency mismatch and a bad phone", async () => {
    process.env.PAYMENT_PROVIDERS = "momo"; resetProviders();
    const bifEvent = await bif(); const rwf = await seedEvent();
    expect((await api().post("/payments/start").send({ provider: "lumicash", eventId: String(rwf._id), packageId: String(rwf.packages[0]._id), phone: "788123456" })).status).toBe(400);
    expect((await api().post("/payments/start").send({ provider: "momo", eventId: String(bifEvent._id), packageId: String(bifEvent.packages[0]._id), phone: "788123456" })).status).toBe(400);
    for (const phone of ["0788123456", "+250788123456", "78 812 3456", "688123456"]) {
      expect((await api().post("/payments/start").send({ provider: "momo", eventId: String(rwf._id), packageId: String(rwf.packages[0]._id), phone })).status).toBe(400);
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it("quantity is clamped to 1..6 and never zero", async () => {
    process.env.PAYMENT_PROVIDERS = "mock"; resetProviders();
    const event = await seedEvent(); const pkg: any = event.packages[0];
    for (const [q, expected] of [["2.5", 2], [0, 1], [-1, 1], [99, 6], ["abc", 1]] as const) {
      const res = await api().post("/payments/start").send({ provider: "mock", eventId: String(event._id), packageId: String(pkg._id), quantity: q, phone: "788123456" });
      expect(res.body.tickets).toHaveLength(expected);
    }
  });
  it("a mock purchase is SUCCESSFUL on the first response and flagged as a test", async () => {
    process.env.PAYMENT_PROVIDERS = "mock"; resetProviders();
    const event = await seedEvent(); const pkg: any = event.packages[0];
    const res = await api().post("/payments/start").send({ provider: "mock", eventId: String(event._id), packageId: String(pkg._id), phone: "788123456" });
    expect(res.status).toBe(200); expect(res.body.mock).toBe(true); expect(res.body.refId).toBeTypeOf("string");
    expect((await api().get(`/payments/${res.body.refId}`)).body.tickets).toHaveLength(1);
    expect(await ticketModel.countDocuments()).toBe(1);
  });
  it("momo start is 202 pending and the momo callback settles once", async () => {
    process.env.PAYMENT_PROVIDERS = "momo"; resetProviders();
    const event = await seedEvent(); const pkg: any = event.packages[0];
    fetchMock.mockResolvedValueOnce(ok({ access_token: "t" })).mockResolvedValueOnce(ok({}, 202));
    const start = await api().post("/payments/start").send({ provider: "momo", eventId: String(event._id), packageId: String(pkg._id), phone: "788123456" });
    expect(start.status).toBe(202);
    fetchMock.mockResolvedValueOnce(ok({ access_token: "t" })).mockResolvedValueOnce(ok({ status: "SUCCESSFUL", amount: "5000", currency: "RWF", financialTransactionId: "FT1", payer: { partyId: "250788123456" } }));
    const cb = await api().post("/payments/momo/callback").send({ externalId: start.body.refId, status: "SUCCESSFUL" });
    expect(cb.status).toBe(200); expect(await ticketModel.countDocuments()).toBe(1);
  });
  it("when the provider says paid but issuing throws, the record stays recoverable", async () => {
    process.env.PAYMENT_PROVIDERS = "mock"; resetProviders();
    const event = await seedEvent(); const pkg: any = event.packages[0];
    const tickets = await import("../services/tickets");
    const spy = vi.spyOn(tickets, "issueTickets").mockRejectedValueOnce(new Error("QR down"));
    const res = await api().post("/payments/start").send({ provider: "mock", eventId: String(event._id), packageId: String(pkg._id), phone: "788123456" });
    expect(res.status).toBe(500); expect(res.body.refId).toBeTypeOf("string");
    expect((await paymentModel.findOne({ refId: res.body.refId }))!.status).toBe("PENDING");
    spy.mockRestore();
    expect((await api().get(`/payments/${res.body.refId}`)).body.tickets).toHaveLength(1);
    expect(await ticketModel.countDocuments()).toBe(1);
  });
  it("lookup proxies the provider and 400s for providers without lookup", async () => {
    Object.assign(process.env, LUMI_ENV); resetProviders();
    lumiOk({ ResponseCode: "01", ResponseMessage: JSON.stringify({ accountName: "A B" }) });
    expect((await api().post("/payments/lookup").send({ provider: "lumicash", phone: "68191919" })).body).toEqual({ ok: true, name: "A B" });
    process.env.PAYMENT_PROVIDERS = "mock"; resetProviders();
    expect((await api().post("/payments/lookup").send({ provider: "mock", phone: "788123456" })).status).toBe(400);
  });
  it("a stale Lumicash payment is only expired after verify says failed", async () => {
    Object.assign(process.env, LUMI_ENV); resetProviders();
    const event = await bif(); const pkg: any = event.packages[0];
    const old = new Date(Date.now() - 31 * 60 * 1000);
    const mk = (refId: string) => paymentModel.create({ refId, provider: "lumicash", status: "PENDING", reserved: true, event: event._id, ticketPackage: pkg, quantity: 1, momoPayload: { requestId: refId, createdDate: old.toISOString() }, createdAt: old });
    await mk("verify-unreachable"); await mk("verify-failed");
    fetchMock.mockRejectedValueOnce(new Error("ECONNREFUSED"));                                  // first record
    lumiOk({ ResponseCode: "01", Status: "02", ResponseMessage: "Transaction failed" });        // second record
    const { releaseStalePayments } = await import("../services/payments");
    await releaseStalePayments();
    expect((await paymentModel.findOne({ refId: "verify-unreachable" }))!.status).toBe("PENDING");
    expect((await paymentModel.findOne({ refId: "verify-failed" }))!.status).toBe("EXPIRED");
  });
  it("a provider amount that is not a number never reaches the ticket", async () => {
    const event = await seedEvent();
    const p = await paymentModel.create({ refId: "nan-1", provider: "mock", amount: 5000, currency: "RWF", event: event._id, ticketPackage: event.packages[0], quantity: 1 });
    const r = await settlePayment(p, { outcome: "successful", amount: NaN, raw: {} });
    expect(r.code).toBe(200); expect(r.body.tickets).toHaveLength(1);
    const t: any = await ticketModel.findOne();
    expect(t.payment.amount).toBe(5000);
  });
  it("a late failed status never overwrites a SUCCESSFUL record", async () => {
    const event = await seedEvent({ packages: [{ title: "Regular", price: 5000, currency: "RWF", capacity: 2, sold: 1 }] });
    const p = await paymentModel.create({ refId: "late-fail", provider: "mock", event: event._id, ticketPackage: event.packages[0], quantity: 1, reserved: true });
    await settlePayment(p, { outcome: "successful", raw: {} });
    await settlePayment(await paymentModel.findOne({ refId: "late-fail" }), { outcome: "failed", reason: "late", raw: {} });
    expect((await paymentModel.findOne({ refId: "late-fail" }))!.status).toBe("SUCCESSFUL");
    expect(await ticketModel.countDocuments()).toBe(1);
    expect((await eventModel.findById(event._id))!.packages[0].sold).toBe(1);
  });
});
