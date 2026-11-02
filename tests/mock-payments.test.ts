import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from "vitest";
import sendMessage from "../services/sms";
import { fetchMock } from "./setup";
import { api, seedEvent, registerOrganiser, eventBody } from "./helpers";
import { ticketModel } from "../models/tickets";

vi.mock("../services/sms", () => ({ default: vi.fn() }));

const smsMock = sendMessage as unknown as ReturnType<typeof vi.fn>;

beforeAll(() => { process.env.PAYMENTS_MODE = "mock"; });
afterAll(() => { delete process.env.PAYMENTS_MODE; });
beforeEach(() => { smsMock.mockReset(); });

async function startPayment(event: any) {
  return api().post("/momo/requestToPay").send({
    amount: "5000",
    currency: "RWF",
    payer: { partyIdType: "MSISDN", partyId: "250788123456" },
    eventId: String(event._id),
    ticketPackage: { title: "Regular", price: 5000, currency: "RWF" },
  });
}

describe("PAYMENTS_MODE=mock (MoMo bypass for testing)", () => {
  it("accepts the payment without calling MTN and says it is a test", async () => {
    const event = await seedEvent();
    const res = await startPayment(event);
    expect(res.status).toBe(202);
    expect(res.body.refId).toBeTypeOf("string");
    expect(res.body.mock).toBe(true);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("reports SUCCESSFUL at once, issues the ticket exactly once, and marks it as a test sale", async () => {
    const event = await seedEvent({ title: "Gospel Night Kigali" });
    const { refId } = (await startPayment(event)).body;

    const first = await api().get(`/momo/statusOfRequest/${refId}`);
    expect(first.status).toBe(200);
    expect(first.body.status).toBe("SUCCESSFUL");
    expect(first.body.mock).toBe(true);
    expect(first.body.tickets).toHaveLength(1);

    const second = await api().get(`/momo/statusOfRequest/${refId}`);
    expect(second.body.tickets).toHaveLength(1);
    expect(second.body.mock).toBe(true);

    expect(fetchMock).not.toHaveBeenCalled();
    expect(await ticketModel.countDocuments()).toBe(1);
    const ticket = await ticketModel.findOne();
    expect(ticket!.momoPayload.mock).toBe(true);
    expect(ticket!.momoPayload.amount).toBe("5000");
    expect(ticket!.momoPayload.payer.partyId).toBe("250788123456");
    expect(String(ticket!.event)).toBe(String(event._id));
    expect(smsMock).toHaveBeenCalledTimes(1);
    expect(smsMock.mock.calls[0][1]).toContain("Gospel Night Kigali");
  });

  it("the ticket can be found by number and scanned (consumed) by the event owner", async () => {
    const owner = await registerOrganiser("owner@example.com");
    const { body: event } = await api().post("/events")
      .set("Authorization", `Bearer ${owner.token}`).send(eventBody());
    const { refId } = (await startPayment(event)).body;
    const { tickets } = (await api().get(`/momo/statusOfRequest/${refId}`)).body;

    const byNumber = await api().get(`/tickets/byNumber/${tickets[0].number}`);
    expect(byNumber.body.status).toBe("pending");
    const consumed = await api().post(`/tickets/consume/${tickets[0].number}`)
      .set("Authorization", `Bearer ${owner.token}`);
    expect(consumed.status).toBe(200);
    expect(consumed.body.status).toBe("consumed");
  });

  it("test sales show up on the organiser dashboard as paid revenue", async () => {
    const owner = await registerOrganiser("owner@example.com");
    const { body: event } = await api().post("/events")
      .set("Authorization", `Bearer ${owner.token}`).send(eventBody());
    const { refId } = (await startPayment(event)).body;
    await api().get(`/momo/statusOfRequest/${refId}`);
    const dash = await api().get(`/events/${event._id}/dashboard`)
      .set("Authorization", `Bearer ${owner.token}`);
    expect(dash.body.totals).toEqual({ tickets: 1, paid: 1, revenue: [{ currency: "RWF", amount: 5000, tickets: 1 }], consumed: 0, pending: 1 });
  });

  it("an unknown reference in mock mode is a 404, not a free ticket", async () => {
    const res = await api().get("/momo/statusOfRequest/does-not-exist");
    expect(res.status).toBe(404);
    expect(await ticketModel.countDocuments()).toBe(0);
  });
});
