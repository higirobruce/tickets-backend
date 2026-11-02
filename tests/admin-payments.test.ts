import { describe, it, expect, vi } from "vitest";
import { api, registerAndLogin, seedEvent, registerOrganiser } from "./helpers";
import { paymentModel } from "../models/payments";
import { ticketModel } from "../models/tickets";
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
});
