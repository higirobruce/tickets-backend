import { describe, it, expect, vi } from "vitest";
import { api, registerAndLogin, registerOrganiser, eventBody } from "./helpers";
import { ticketModel } from "../models/tickets";

vi.mock("../services/sms", () => ({ default: vi.fn() }));

const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });

async function organiserWithEvent(email = "owner@example.com") {
  const owner = await registerOrganiser(email);
  const { body: event } = await api().post("/events").set(bearer(owner.token)).send(eventBody());
  return { owner, event };
}

describe("organiser-managed gate staff", () => {
  it("an organiser can add gate staff who can only scan that organiser's events", async () => {
    const { owner, event } = await organiserWithEvent();
    const other = await organiserWithEvent("other@example.com");

    const created = await api().post("/users/staff").set(bearer(owner.token))
      .send({ firstName: "Gate", lastName: "One", email: "gate@example.com", password: "gate-pass-1" });
    expect(created.status).toBe(201);
    expect(created.body.role).toBe("staff");
    expect(created.body.organiser).toBe(owner.user._id);
    expect(created.body.password).toBeUndefined();

    const login = await api().post("/users/login").send({ username: "gate@example.com", password: "gate-pass-1" });
    expect(login.status).toBe(200);
    const staff = login.body.token;

    await ticketModel.create([
      { number: 1, qrCode: "x", event: event._id },
      { number: 2, qrCode: "x", event: other.event._id },
    ]);
    expect((await api().post("/tickets/consume/2").set(bearer(staff))).status).toBe(403);
    const ok = await api().post("/tickets/consume/1").set(bearer(staff));
    expect(ok.status).toBe(200);
    expect(ok.body.status).toBe("consumed");

    const list = await api().get("/tickets").set(bearer(staff));
    expect(list.body.map((t: any) => t.number)).toEqual([1]);
  });

  it("an organiser sees and can remove their own staff only", async () => {
    const { owner } = await organiserWithEvent();
    const other = await registerOrganiser("other@example.com");
    await api().post("/users/staff").set(bearer(owner.token)).send({ firstName: "A", email: "a@example.com", password: "pw-123456" });
    await api().post("/users/staff").set(bearer(other.token)).send({ firstName: "B", email: "b@example.com", password: "pw-123456" });

    const mine = await api().get("/users/staff").set(bearer(owner.token));
    expect(mine.body.map((u: any) => u.email)).toEqual(["a@example.com"]);

    const theirs = mine.body[0]._id;
    const notMine = (await api().get("/users/staff").set(bearer(other.token))).body[0]._id;
    expect((await api().delete(`/users/staff/${notMine}`).set(bearer(owner.token))).status).toBe(404);
    expect((await api().delete(`/users/staff/${theirs}`).set(bearer(owner.token))).status).toBe(200);
    expect((await api().get("/users/staff").set(bearer(owner.token))).body).toHaveLength(0);
  });

  it("staff and anonymous callers cannot create staff", async () => {
    const { owner } = await organiserWithEvent();
    await api().post("/users/staff").set(bearer(owner.token)).send({ firstName: "A", email: "a@example.com", password: "pw-123456" });
    const login = await api().post("/users/login").send({ username: "a@example.com", password: "pw-123456" });
    expect((await api().post("/users/staff").set(bearer(login.body.token)).send({ firstName: "B", email: "b@example.com", password: "pw-123456" })).status).toBe(403);
    expect((await api().post("/users/staff").send({ firstName: "B", email: "b@example.com", password: "pw-123456" })).status).toBe(401);
  });

  it("platform staff created by an admin still scan everything", async () => {
    const admin = await registerAndLogin("admin@example.com");
    const { event } = await organiserWithEvent();
    await api().post("/users").set(bearer(admin.token)).send({ firstName: "Door", email: "door@example.com", password: "pw-123456" });
    const login = await api().post("/users/login").send({ username: "door@example.com", password: "pw-123456" });
    await ticketModel.create({ number: 5, qrCode: "x", event: event._id });
    expect((await api().post("/tickets/consume/5").set(bearer(login.body.token))).status).toBe(200);
  });
});

describe("scanning", () => {
  it("a scan by number returns the ticket with its event and admits it in one call", async () => {
    const { owner, event } = await organiserWithEvent();
    await ticketModel.create({ number: 7, qrCode: "x", event: event._id, ticketPackage: { title: "VIP", price: 1 } });

    const look = await api().get("/tickets/scan/7").set(bearer(owner.token));
    expect(look.status).toBe(200);
    expect(look.body.ticket.number).toBe(7);
    expect(look.body.event.title).toBe(event.title);
    expect(look.body.admitted).toBe(false);

    const admit = await api().post("/tickets/scan/7").set(bearer(owner.token));
    expect(admit.status).toBe(200);
    expect(admit.body.ticket.status).toBe("consumed");
    expect(admit.body.admitted).toBe(true);

    const again = await api().post("/tickets/scan/7").set(bearer(owner.token));
    expect(again.status).toBe(409);
    expect(again.body.ticket.status).toBe("consumed");
    expect(again.body.errorMessage).toMatch(/already/i);
  });

  it("scanning accepts the full QR link as well as a bare number", async () => {
    const { owner, event } = await organiserWithEvent();
    await ticketModel.create({ number: 8, qrCode: "x", event: event._id });
    const res = await api().post("/tickets/scan/" + encodeURIComponent("http://api.test/tickets/validate/8")).set(bearer(owner.token));
    expect(res.status).toBe(200);
    expect(res.body.ticket.number).toBe(8);
  });

  it("an unknown ticket is a 404 and another organiser's ticket a 403", async () => {
    const { owner } = await organiserWithEvent();
    const other = await organiserWithEvent("other@example.com");
    await ticketModel.create({ number: 9, qrCode: "x", event: other.event._id });
    expect((await api().post("/tickets/scan/123").set(bearer(owner.token))).status).toBe(404);
    expect((await api().post("/tickets/scan/9").set(bearer(owner.token))).status).toBe(403);
  });
});
