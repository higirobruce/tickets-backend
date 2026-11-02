import { describe, it, expect, vi } from "vitest";
import { api, registerOrganiser, eventBody, registerAndLogin } from "./helpers";
import { ticketModel } from "../models/tickets";
vi.mock("../services/sms", () => ({ default: vi.fn() }));

async function eventWithMixedSales() {
  const owner = await registerOrganiser();
  const { body: event } = await api().post("/events").set("Authorization", `Bearer ${owner.token}`)
    .send(eventBody({ packages: [{ title: "Regular", price: 5000, currency: "RWF" }, { title: "VIP", price: 7000, currency: "BIF" }] }));
  await ticketModel.create({ number: 10000001, qrCode: "x", event: event._id, ticketPackage: event.packages[0], momoPayload: { amount: "5000", payer: { partyId: "250788123456" } } });
  await ticketModel.create({ number: 10000002, qrCode: "x", event: event._id, ticketPackage: event.packages[1], payment: { provider: "lumicash", amount: 7000, currency: "BIF", phone: "25768191919" } });
  await ticketModel.create({ number: 10000003, qrCode: "x", event: event._id, ticketPackage: event.packages[1], payment: { provider: "lumicash", amount: 7000, currency: "BIF", phone: "25768191919" } });
  return { owner, event };
}

describe("revenue per currency", () => {
  it("the event dashboard reports one line per currency", async () => {
    const { owner, event } = await eventWithMixedSales();
    const dash = await api().get(`/events/${event._id}/dashboard`).set("Authorization", `Bearer ${owner.token}`);
    expect(dash.body.totals.revenue).toEqual([{ currency: "BIF", amount: 14000, tickets: 2 }, { currency: "RWF", amount: 5000, tickets: 1 }]);
    expect(dash.body.totals.paid).toBe(3);
    expect(dash.body.byPackage).toEqual(expect.arrayContaining([expect.objectContaining({ title: "VIP", currency: "BIF", revenue: 14000 })]));
    expect(dash.body.recent[0].payment.phone).toBe("25768191919");
  });
  it("the admin overview and organiser rows use the same shape", async () => {
    const admin = await registerAndLogin("admin@example.com");
    await eventWithMixedSales();
    const o = await api().get("/admin/overview").set("Authorization", `Bearer ${admin.token}`);
    expect(o.body.totals.revenue).toEqual([{ currency: "BIF", amount: 14000, tickets: 2 }, { currency: "RWF", amount: 5000, tickets: 1 }]);
    expect(o.body.organisers[0].revenue).toEqual(o.body.totals.revenue);
  });
  it("the attendee CSV shows Lumicash phones and amounts", async () => {
    const { owner, event } = await eventWithMixedSales();
    const csv = await api().get(`/events/${event._id}/attendees.csv`).set("Authorization", `Bearer ${owner.token}`);
    expect(csv.text).toContain("+25768191919"); expect(csv.text).toContain("7000");
  });
});
