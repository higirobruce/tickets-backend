import { describe, it, expect, vi, beforeEach } from "vitest";
import sendMessage from "../services/sms";
import { sendTicketEmail } from "../services/email";
import { api, registerOrganiser, registerAndLogin, eventBody } from "./helpers";
import { ticketModel } from "../models/tickets";

vi.mock("../services/sms", () => ({ default: vi.fn() }));
vi.mock("../services/email", () => ({ sendTicketEmail: vi.fn(async () => true), emailConfigured: () => true }));

const smsMock = sendMessage as unknown as ReturnType<typeof vi.fn>;
const emailMock = sendTicketEmail as unknown as ReturnType<typeof vi.fn>;
const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });
beforeEach(() => { smsMock.mockReset(); emailMock.mockClear(); });

async function organiserWithEvent(email = "owner@example.com", over: any = {}) {
  const owner = await registerOrganiser(email);
  const { body: event } = await api().post("/events").set(bearer(owner.token)).send(eventBody(over));
  return { owner, event };
}

describe("complimentary tickets", () => {
  it("an organiser can issue free tickets for their own event, with an SMS when a phone is given", async () => {
    const { owner, event } = await organiserWithEvent();
    const res = await api().post(`/events/${event._id}/complimentary`).set(bearer(owner.token))
      .send({ packageId: event.packages[1]._id, quantity: 2, phone: "250788000777", note: "Press" });
    expect(res.status).toBe(201);
    expect(res.body).toHaveLength(2);
    expect(res.body[0].ticketPackage.title).toBe("VIP");
    expect(res.body[0].complimentary).toBe(true);
    expect(smsMock).toHaveBeenCalledTimes(2);
    const dash = await api().get(`/events/${event._id}/dashboard`).set(bearer(owner.token));
    expect(dash.body.totals.tickets).toBe(2);
    expect(dash.body.totals.paid).toBe(0);
    expect(dash.body.totals.revenue).toBe(0);
  });

  it("complimentary tickets count against capacity and respect it", async () => {
    const { owner, event } = await organiserWithEvent("o@example.com", { packages: [{ title: "Regular", price: 5000, capacity: 2 }] });
    const ok = await api().post(`/events/${event._id}/complimentary`).set(bearer(owner.token)).send({ packageId: event.packages[0]._id, quantity: 2 });
    expect(ok.status).toBe(201);
    const over = await api().post(`/events/${event._id}/complimentary`).set(bearer(owner.token)).send({ packageId: event.packages[0]._id, quantity: 1 });
    expect(over.status).toBe(409);
  });

  it("another organiser gets 403", async () => {
    const { event } = await organiserWithEvent();
    const other = await registerOrganiser("other@example.com");
    expect((await api().post(`/events/${event._id}/complimentary`).set(bearer(other.token)).send({ packageId: event.packages[0]._id, quantity: 1 })).status).toBe(403);
  });
});

describe("attendee export", () => {
  it("returns a CSV of every ticket for the event", async () => {
    const { owner, event } = await organiserWithEvent();
    await ticketModel.create([
      { number: 1, qrCode: "x", event: event._id, ticketPackage: { title: "VIP", price: 20000 }, momoPayload: { amount: "20000", payer: { partyId: "250788000001" } }, status: "consumed", buyer: { name: "Aline", email: "aline@example.com" } },
      { number: 2, qrCode: "x", event: event._id, ticketPackage: { title: "Regular", price: 5000 }, momoPayload: { amount: "5000", payer: { partyId: "250788000002" } } },
    ]);
    const res = await api().get(`/events/${event._id}/attendees.csv`).set(bearer(owner.token));
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toMatch(/text\/csv/);
    expect(res.headers["content-disposition"]).toMatch(/attachment/);
    const lines = res.text.trim().split("\n");
    expect(lines[0]).toBe("number,package,status,phone,buyer,email,amount,purchased_at,checked_in_at");
    expect(lines).toHaveLength(3);
    expect(lines[1]).toContain("1,VIP,consumed,+250788000001,Aline,aline@example.com,20000");
  });
});

describe("SMS broadcast", () => {
  it("sends one message per distinct ticket holder phone, prefixed with the event", async () => {
    const { owner, event } = await organiserWithEvent("o@example.com", { title: "Gospel Night" });
    await ticketModel.create([
      { number: 1, qrCode: "x", event: event._id, momoPayload: { payer: { partyId: "250788000001" } } },
      { number: 2, qrCode: "x", event: event._id, momoPayload: { payer: { partyId: "250788000001" } } },
      { number: 3, qrCode: "x", event: event._id, momoPayload: { payer: { partyId: "250788000002" } } },
      { number: 4, qrCode: "x", event: event._id },
    ]);
    const res = await api().post(`/events/${event._id}/broadcast`).set(bearer(owner.token)).send({ message: "Doors open at 17:00. Come early!" });
    expect(res.status).toBe(200);
    expect(res.body.recipients).toBe(2);
    expect(smsMock).toHaveBeenCalledTimes(2);
    expect(smsMock.mock.calls.map((c) => c[0]).sort()).toEqual(["+250788000001", "+250788000002"]);
    expect(smsMock.mock.calls[0][1]).toBe("Gospel Night: Doors open at 17:00. Come early!");
  });

  it("rejects empty or over-long messages", async () => {
    const { owner, event } = await organiserWithEvent();
    expect((await api().post(`/events/${event._id}/broadcast`).set(bearer(owner.token)).send({ message: "" })).status).toBe(400);
    expect((await api().post(`/events/${event._id}/broadcast`).set(bearer(owner.token)).send({ message: "x".repeat(400) })).status).toBe(400);
  });
});

describe("draft events", () => {
  it("unpublished events are hidden from the public list and page but visible to the owner", async () => {
    const { owner, event } = await organiserWithEvent("o@example.com", { published: false });
    expect((await api().get("/events")).body.find((e: any) => e._id === event._id)).toBeUndefined();
    expect((await api().get(`/events/${event._id}`)).status).toBe(404);
    expect((await api().get("/events/mine").set(bearer(owner.token))).body).toHaveLength(1);
    await api().put(`/events/${event._id}`).set(bearer(owner.token)).send({ published: true });
    expect((await api().get(`/events/${event._id}`)).status).toBe(200);
  });

  it("events default to published", async () => {
    const { event } = await organiserWithEvent();
    expect(event.published).toBe(true);
  });
});

describe("email delivery", () => {
  it("emails the ticket when the buyer gave an address", async () => {
    const { event } = await organiserWithEvent();
    process.env.PAYMENTS_MODE = "mock";
    try {
      const pay = await api().post("/momo/requestToPay").send({
        amount: "5000", currency: "RWF", payer: { partyIdType: "MSISDN", partyId: "250788123456" },
        eventId: String(event._id), ticketPackage: event.packages[0], quantity: 1,
        buyer: { name: "Aline", email: "aline@example.com" },
      });
      await api().get(`/momo/statusOfRequest/${pay.body.refId}`);
    } finally {
      delete process.env.PAYMENTS_MODE;
    }
    expect(emailMock).toHaveBeenCalledTimes(1);
    const [to, ticket, ev] = emailMock.mock.calls[0];
    expect(to).toBe("aline@example.com");
    expect(ticket.number).toBeTypeOf("number");
    expect(ev.title).toBe(event.title);
    const saved = await ticketModel.findOne();
    expect(saved!.buyer!.email).toBe("aline@example.com");
  });
});
