import { describe, it, expect, vi, beforeEach } from "vitest";
import sendMessage from "../services/sms";
import { sendPasswordResetEmail } from "../services/email";
import { api, registerAndLogin, registerOrganiser, eventBody } from "./helpers";
import { userModel } from "../models/users";
import { ticketModel } from "../models/tickets";

vi.mock("../services/sms", () => ({ default: vi.fn() }));
vi.mock("../services/email", () => ({
  sendTicketEmail: vi.fn(async () => true),
  sendPasswordResetEmail: vi.fn(async () => true),
  emailConfigured: () => true,
}));

const smsMock = sendMessage as unknown as ReturnType<typeof vi.fn>;
const resetMailMock = sendPasswordResetEmail as unknown as ReturnType<typeof vi.fn>;
const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });
beforeEach(() => { smsMock.mockReset(); resetMailMock.mockClear(); });

describe("password reset", () => {
  it("emails a reset link and the link sets a new password once", async () => {
    await registerOrganiser("owner@example.com");
    const ask = await api().post("/users/forgot").send({ email: "owner@example.com" });
    expect(ask.status).toBe(200);
    expect(resetMailMock).toHaveBeenCalledTimes(1);
    const [to, link] = resetMailMock.mock.calls[0];
    expect(to).toBe("owner@example.com");
    const token = new URL(link).searchParams.get("token");
    expect(token).toBeTruthy();

    const bad = await api().post("/users/reset").send({ token, password: "short" });
    expect(bad.status).toBe(400);
    const ok = await api().post("/users/reset").send({ token, password: "new-pass-123" });
    expect(ok.status).toBe(200);
    expect(ok.body.token).toBeTypeOf("string");

    expect((await api().post("/users/login").send({ username: "owner@example.com", password: "pw-123456" })).status).toBe(401);
    expect((await api().post("/users/login").send({ username: "owner@example.com", password: "new-pass-123" })).status).toBe(200);
    expect((await api().post("/users/reset").send({ token, password: "again-123" })).status).toBe(400);
  });

  it("sends a code by SMS when the account has a phone and no email delivery would work", async () => {
    const reg = await api().post("/users/register").send({ firstName: "P", email: "phone@example.com", password: "pw-123456", organisation: "X", phoneNumber: { countryCode: "250", phone: "788000999" } });
    expect(reg.status).toBe(201);
    const ask = await api().post("/users/forgot").send({ email: "phone@example.com", via: "sms" });
    expect(ask.status).toBe(200);
    expect(smsMock).toHaveBeenCalledTimes(1);
    expect(smsMock.mock.calls[0][0]).toBe("+250788000999");
    const code = smsMock.mock.calls[0][1].match(/\d{6}/)![0];
    const ok = await api().post("/users/reset").send({ email: "phone@example.com", code, password: "new-pass-123" });
    expect(ok.status).toBe(200);
    expect((await api().post("/users/login").send({ username: "phone@example.com", password: "new-pass-123" })).status).toBe(200);
  });

  it("never reveals whether an email exists", async () => {
    const res = await api().post("/users/forgot").send({ email: "nobody@example.com" });
    expect(res.status).toBe(200);
    expect(resetMailMock).not.toHaveBeenCalled();
  });

  it("a logged-in user can change their password with the current one", async () => {
    const { token } = await registerOrganiser("owner@example.com");
    expect((await api().post("/users/password").set(bearer(token)).send({ current: "wrong", password: "new-pass-123" })).status).toBe(401);
    expect((await api().post("/users/password").set(bearer(token)).send({ current: "pw-123456", password: "new-pass-123" })).status).toBe(200);
    expect((await api().post("/users/login").send({ username: "owner@example.com", password: "new-pass-123" })).status).toBe(200);
  });
});

describe("platform admin overview", () => {
  it("summarises organisers, events, tickets and revenue for admins only", async () => {
    const admin = await registerAndLogin("admin@example.com");
    const a = await registerOrganiser("a@example.com", "Alpha Events");
    const b = await registerOrganiser("b@example.com", "Beta Events");
    const { body: e1 } = await api().post("/events").set(bearer(a.token)).send(eventBody({ title: "A1" }));
    const { body: e2 } = await api().post("/events").set(bearer(a.token)).send(eventBody({ title: "A2" }));
    const { body: e3 } = await api().post("/events").set(bearer(b.token)).send(eventBody({ title: "B1" }));
    await ticketModel.create([
      { number: 1, qrCode: "x", event: e1._id, ticketPackage: { title: "VIP", price: 20000 }, momoPayload: { amount: "20000" } },
      { number: 2, qrCode: "x", event: e2._id, ticketPackage: { title: "Regular", price: 5000 }, momoPayload: { amount: "5000" }, status: "consumed" },
      { number: 3, qrCode: "x", event: e3._id, ticketPackage: { title: "Regular", price: 5000 }, momoPayload: { amount: "5000" } },
      { number: 4, qrCode: "x", event: e3._id, ticketPackage: { title: "Regular", price: 5000 }, complimentary: true },
    ]);

    expect((await api().get("/admin/overview").set(bearer(a.token))).status).toBe(403);
    expect((await api().get("/admin/overview")).status).toBe(401);

    const res = await api().get("/admin/overview").set(bearer(admin.token));
    expect(res.status).toBe(200);
    expect(res.body.totals).toEqual({ organisers: 2, events: 3, tickets: 4, paid: 3, revenue: [{ currency: "RWF", amount: 30000, tickets: 3 }], consumed: 1 });
    const alpha = res.body.organisers.find((o: any) => o.email === "a@example.com");
    expect(alpha.organisation).toBe("Alpha Events");
    expect(alpha.events).toBe(2);
    expect(alpha.tickets).toBe(2);
    expect(alpha.revenue).toEqual([{ currency: "RWF", amount: 25000, tickets: 2 }]);
    expect(res.body.recentEvents.map((e: any) => e.title).sort()).toEqual(["A1", "A2", "B1"]);
    expect(res.body.recentEvents[0].owner.organisation).toBeTypeOf("string");
  });

  it("admins can change a user's role", async () => {
    const admin = await registerAndLogin("admin@example.com");
    const a = await registerOrganiser("a@example.com");
    const res = await api().put(`/admin/users/${a.user._id}`).set(bearer(admin.token)).send({ role: "admin" });
    expect(res.status).toBe(200);
    expect(res.body.role).toBe("admin");
    expect((await api().put(`/admin/users/${a.user._id}`).set(bearer(admin.token)).send({ role: "king" })).status).toBe(400);
    expect((await api().put(`/admin/users/${a.user._id}`).set(bearer(a.token)).send({ role: "organiser" })).status).toBe(403);
    const fresh = await userModel.findById(a.user._id);
    expect(fresh!.role).toBe("admin");
  });
});
