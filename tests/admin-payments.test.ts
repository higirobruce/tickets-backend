import { describe, it, expect, vi } from "vitest";
import { api, registerAndLogin, seedEvent, registerOrganiser } from "./helpers";
import { paymentModel } from "../models/payments";
import { ticketModel } from "../models/tickets";
import { eventModel } from "../models/events";
import { fetchMock } from "./setup";
import { resetProviders } from "../services/providers/registry";
import { LUMI_ENV } from "./lumicashEnv";
vi.mock("../services/sms", () => ({ default: vi.fn() }));

describe("admin payments", () => {
  it("lists pending Lumicash payments without secrets and verify issues the ticket", async () => {
    Object.assign(process.env, LUMI_ENV); resetProviders();
    const { token } = await registerAndLogin();            // first account is admin
    const event = await seedEvent({ packages: [{ title: "VIP", price: 7000, currency: "BIF" }] });
    await paymentModel.create({ refId: "stuck", provider: "lumicash", status: "PENDING", amount: 7000, currency: "BIF", phone: "25768191919", event: event._id, ticketPackage: event.packages[0], quantity: 1, momoPayload: { requestId: "stuck", createdDate: new Date().toISOString(), Password: "must-not-leak" } });
    const list = await api().get("/admin/payments?status=PENDING&provider=lumicash").set("Authorization", `Bearer ${token}`);
    expect(list.status).toBe(200); expect(list.body.payments).toHaveLength(1);
    expect(JSON.stringify(list.body)).not.toContain("must-not-leak");
    fetchMock.mockResolvedValueOnce({ ok: true, status: 200, statusText: "OK", json: async () => ({ ResponseCode: "01", Status: "01", TransCode: "T1", TransAmount: 7000 }) });
    const v = await api().post("/admin/payments/stuck/verify").set("Authorization", `Bearer ${token}`);
    expect(v.status).toBe(200); expect(v.body.status).toBe("SUCCESSFUL");
    expect(await ticketModel.countDocuments()).toBe(1);
  });
  it("organisers cannot see payments", async () => {
    const { token } = await registerOrganiser();
    expect((await api().get("/admin/payments").set("Authorization", `Bearer ${token}`)).status).toBe(403);
  });
  it("release expires a pending payment, frees its seats and records who did it", async () => {
    const { token, user } = await registerAndLogin();
    const event = await seedEvent({ packages: [{ title: "VIP", price: 7000, currency: "BIF", capacity: 3, sold: 2 }] });
    await paymentModel.create({ refId: "hung", provider: "lumicash", status: "PENDING", reserved: true, event: event._id, ticketPackage: event.packages[0], quantity: 2 });
    const r = await api().post("/admin/payments/hung/release").set("Authorization", `Bearer ${token}`);
    expect(r.status).toBe(200); expect(r.body).toEqual({ refId: "hung", status: "EXPIRED" });
    const rec: any = await paymentModel.findOne({ refId: "hung" });
    expect(rec.status).toBe("EXPIRED"); expect(rec.reserved).toBe(false);
    expect(String(rec.releasedBy)).toBe(String(user._id)); expect(rec.releasedAt).toBeInstanceOf(Date);
    expect((await eventModel.findById(event._id))!.packages[0].sold).toBe(0);
    const again = await api().post("/admin/payments/hung/release").set("Authorization", `Bearer ${token}`);
    expect(again.status).toBe(409); expect(again.body).toEqual({ errorMessage: "Only a pending payment can be released" });
    expect((await eventModel.findById(event._id))!.packages[0].sold).toBe(0);
    expect((await api().post("/admin/payments/nope/release").set("Authorization", `Bearer ${token}`)).status).toBe(404);
    expect(await ticketModel.countDocuments()).toBe(0);
  });
  it("organisers cannot release payments", async () => {
    const { token } = await registerOrganiser();
    await paymentModel.create({ refId: "hung2", provider: "lumicash", status: "PENDING" });
    expect((await api().post("/admin/payments/hung2/release").set("Authorization", `Bearer ${token}`)).status).toBe(403);
    expect((await paymentModel.findOne({ refId: "hung2" }))!.status).toBe("PENDING");
  });
  it("the list filters ISSUING records and returns updatedAt", async () => {
    const { token } = await registerAndLogin();
    await paymentModel.create({ refId: "mid", provider: "mock", status: "ISSUING" });
    await paymentModel.create({ refId: "other", provider: "mock", status: "PENDING" });
    const list = await api().get("/admin/payments?status=ISSUING").set("Authorization", `Bearer ${token}`);
    expect(list.body.payments.map((p: any) => p.refId)).toEqual(["mid"]);
    expect(list.body.payments[0].updatedAt).toBeTypeOf("string");
    const all = await api().get("/admin/payments").set("Authorization", `Bearer ${token}`);
    expect(all.body.payments).toHaveLength(2);
  });
});
