import { describe, it, expect, vi } from "vitest";
import { api, registerAndLogin, registerOrganiser, eventBody } from "./helpers";
import { ticketModel } from "../models/tickets";
import { eventModel } from "../models/events";

vi.mock("../services/sms", () => ({ default: vi.fn() }));

const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });

describe("organiser onboarding", () => {
  it("self-signup creates an active organiser and logs them in", async () => {
    const { status, token, user } = await registerOrganiser();
    expect(status).toBe(201);
    expect(token).toBeTypeOf("string");
    expect(user.role).toBe("organiser");
    expect(user.organisation).toBe("Kigali Live");
    expect(user.password).toBeUndefined();
    const me = await api().get("/users/me").set(bearer(token));
    expect(me.body.email).toBe("owner@example.com");
    expect(me.body.role).toBe("organiser");
  });

  it("rejects a second signup with the same email", async () => {
    await registerOrganiser();
    const again = await registerOrganiser();
    expect(again.status).toBe(409);
  });

  it("requires the basic fields", async () => {
    const res = await api().post("/users/register").send({ email: "x@x.com" });
    expect(res.status).toBe(400);
  });

  it("the first account created through /users is the admin; later staff need an admin", async () => {
    const admin = await registerAndLogin("admin@example.com");
    expect(admin.user.role).toBe("admin");
    const organiser = await registerOrganiser();
    const byOrganiser = await api().post("/users").set(bearer(organiser.token))
      .send({ firstName: "G", email: "g@x.com", password: "pw-123456" });
    expect(byOrganiser.status).toBe(403);
    const byAdmin = await api().post("/users").set(bearer(admin.token))
      .send({ firstName: "G", email: "g@x.com", password: "pw-123456" });
    expect(byAdmin.status).toBe(201);
    expect(byAdmin.body.role).toBe("staff");
  });
});

describe("event ownership", () => {
  it("an organiser can create several events and list only their own", async () => {
    const a = await registerOrganiser("a@example.com");
    const b = await registerOrganiser("b@example.com");
    const e1 = await api().post("/events").set(bearer(a.token)).send(eventBody({ title: "One" }));
    const e2 = await api().post("/events").set(bearer(a.token)).send(eventBody({ title: "Two" }));
    await api().post("/events").set(bearer(b.token)).send(eventBody({ title: "Theirs" }));
    expect(e1.status).toBe(201);
    expect(e1.body.owner).toBe(a.user._id);
    expect(e2.body.owner).toBe(a.user._id);

    const mine = await api().get("/events/mine").set(bearer(a.token));
    expect(mine.body.map((e: any) => e.title).sort()).toEqual(["One", "Two"]);
    const pub = await api().get("/events");
    expect(pub.body).toHaveLength(3);
  });

  it("an admin sees every event in /events/mine", async () => {
    const admin = await registerAndLogin("admin@example.com");
    const a = await registerOrganiser("a@example.com");
    await api().post("/events").set(bearer(a.token)).send(eventBody());
    await eventModel.create(eventBody({ title: "Legacy, no owner" }));
    const mine = await api().get("/events/mine").set(bearer(admin.token));
    expect(mine.body).toHaveLength(2);
  });

  it("only the owner or an admin can edit an event", async () => {
    const admin = await registerAndLogin("admin@example.com");
    const a = await registerOrganiser("a@example.com");
    const b = await registerOrganiser("b@example.com");
    const { body: event } = await api().post("/events").set(bearer(a.token)).send(eventBody());

    const byB = await api().put(`/events/${event._id}`).set(bearer(b.token)).send({ title: "Hijacked" });
    expect(byB.status).toBe(403);
    const byA = await api().put(`/events/${event._id}`).set(bearer(a.token))
      .send({ title: "Renamed", packages: [{ title: "VIP", price: 25000, soldOut: true }], owner: b.user._id });
    expect(byA.status).toBe(200);
    expect(byA.body.title).toBe("Renamed");
    expect(byA.body.packages[0].soldOut).toBe(true);
    expect(byA.body.owner).toBe(a.user._id); // owner cannot be reassigned by the organiser
    const byAdmin = await api().put(`/events/${event._id}`).set(bearer(admin.token)).send({ location: "Huye" });
    expect(byAdmin.status).toBe(200);
    expect(byAdmin.body.location).toBe("Huye");
  });

  it("anonymous callers cannot create events", async () => {
    expect((await api().post("/events").send(eventBody())).status).toBe(401);
  });
});

describe("event dashboard", () => {
  async function seedSales(eventId: any, otherEventId: any) {
    await ticketModel.create([
      { number: 1, qrCode: "x", event: eventId, ticketPackage: { title: "VIP", price: 20000 }, momoPayload: { amount: "20000", payer: { partyId: "250788000001" } }, status: "consumed" },
      { number: 2, qrCode: "x", event: eventId, ticketPackage: { title: "VIP", price: 20000 }, momoPayload: { amount: "20000", payer: { partyId: "250788000002" } } },
      { number: 3, qrCode: "x", event: eventId, ticketPackage: { title: "Regular", price: 5000 }, momoPayload: { amount: "5000", payer: { partyId: "250788000003" } } },
      { number: 4, qrCode: "x", event: eventId, ticketPackage: { title: "Regular", price: 5000 } }, // complimentary, no payment
      { number: 5, qrCode: "x", event: otherEventId, ticketPackage: { title: "VIP", price: 20000 }, momoPayload: { amount: "20000" } },
    ]);
  }

  it("returns totals, per-package figures and recent sales for the owner", async () => {
    const a = await registerOrganiser("a@example.com");
    const b = await registerOrganiser("b@example.com");
    const { body: event } = await api().post("/events").set(bearer(a.token)).send(eventBody());
    const { body: other } = await api().post("/events").set(bearer(b.token)).send(eventBody());
    await seedSales(event._id, other._id);

    const res = await api().get(`/events/${event._id}/dashboard`).set(bearer(a.token));
    expect(res.status).toBe(200);
    expect(res.body.event.title).toBe(event.title);
    expect(res.body.totals).toEqual({ tickets: 4, paid: 3, revenue: 45000, consumed: 1, pending: 3 });
    const vip = res.body.byPackage.find((p: any) => p.title === "VIP");
    expect(vip).toEqual({ title: "VIP", count: 2, revenue: 40000, consumed: 1 });
    expect(res.body.recent).toHaveLength(4);
    expect(res.body.recent[0].qrCode).toBeUndefined();
    expect(res.body.recent[0].number).toBeTypeOf("number");
  });

  it("is hidden from other organisers and anonymous callers, open to admins", async () => {
    const admin = await registerAndLogin("admin@example.com");
    const a = await registerOrganiser("a@example.com");
    const b = await registerOrganiser("b@example.com");
    const { body: event } = await api().post("/events").set(bearer(a.token)).send(eventBody());
    expect((await api().get(`/events/${event._id}/dashboard`)).status).toBe(401);
    expect((await api().get(`/events/${event._id}/dashboard`).set(bearer(b.token))).status).toBe(403);
    expect((await api().get(`/events/${event._id}/dashboard`).set(bearer(admin.token))).status).toBe(200);
  });
});

describe("organiser limits on ticket routes", () => {
  it("ticket list and summary only cover the organiser's own events", async () => {
    const a = await registerOrganiser("a@example.com");
    const b = await registerOrganiser("b@example.com");
    const { body: mine } = await api().post("/events").set(bearer(a.token)).send(eventBody());
    const { body: theirs } = await api().post("/events").set(bearer(b.token)).send(eventBody());
    await ticketModel.create([
      { number: 1, qrCode: "x", event: mine._id, ticketPackage: { title: "VIP", price: 1 }, momoPayload: { amount: "1" } },
      { number: 2, qrCode: "x", event: theirs._id, ticketPackage: { title: "VIP", price: 1 }, momoPayload: { amount: "1" } },
      { number: 3, qrCode: "x", ticketPackage: { title: "VIP", price: 1 }, momoPayload: { amount: "1" } },
    ]);
    const list = await api().get("/tickets").set(bearer(a.token));
    expect(list.body.map((t: any) => t.number)).toEqual([1]);
    expect((await api().get(`/tickets?event=${theirs._id}`).set(bearer(a.token))).status).toBe(403);
    const summary = await api().get("/tickets/summary").set(bearer(a.token));
    expect(summary.body).toEqual([{ _id: "VIP", count: 1, total: 1 }]);
    expect((await api().get(`/tickets/summary?event=${theirs._id}`).set(bearer(a.token))).status).toBe(403);
  });

  it("an organiser can consume tickets for their own events only", async () => {
    const a = await registerOrganiser("a@example.com");
    const b = await registerOrganiser("b@example.com");
    const { body: mine } = await api().post("/events").set(bearer(a.token)).send(eventBody());
    const { body: theirs } = await api().post("/events").set(bearer(b.token)).send(eventBody());
    await ticketModel.create([
      { number: 1, qrCode: "x", event: mine._id },
      { number: 2, qrCode: "x", event: theirs._id },
    ]);
    expect((await api().post("/tickets/consume/2").set(bearer(a.token))).status).toBe(403);
    const ok = await api().post("/tickets/consume/1").set(bearer(a.token));
    expect(ok.status).toBe(200);
    expect(ok.body.status).toBe("consumed");
  });
});
