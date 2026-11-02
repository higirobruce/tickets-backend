import { describe, it, expect, vi, beforeEach } from "vitest";
import { fetchMock } from "./setup";
import { api, seedEvent, registerOrganiser, eventBody } from "./helpers";
import { ticketModel } from "../models/tickets";
import { eventModel } from "../models/events";
import { paymentModel } from "../models/payments";

vi.mock("../services/sms", () => ({ default: vi.fn() }));

const momo = (body: any, status = 200) => ({ ok: status < 400, status, statusText: "OK", json: async () => body });
const successful = (over: any = {}) => ({
  status: "SUCCESSFUL", amount: "5000", currency: "RWF", financialTransactionId: "FT1",
  payer: { partyIdType: "MSISDN", partyId: "250788123456" }, ...over,
});

async function start(event: any, pkg: any, quantity = 1) {
  fetchMock.mockResolvedValueOnce(momo({ access_token: "tok" })).mockResolvedValueOnce(momo({}, 202));
  return api().post("/momo/requestToPay").send({
    amount: String(pkg.price * quantity), currency: "RWF",
    payer: { partyIdType: "MSISDN", partyId: "250788123456" },
    eventId: String(event._id), ticketPackage: pkg, quantity,
  });
}

describe("MoMo callback", () => {
  it("requestToPay registers a callback URL and uses the reference as externalId", async () => {
    const event = await seedEvent();
    const res = await start(event, event.packages[0]);
    expect(res.status).toBe(202);
    const [, init] = fetchMock.mock.calls[1];
    expect(init.headers["X-Callback-Url"]).toBe(`http://api.test/payments/momo/callback`);
    expect(JSON.parse(init.body).externalId).toBe(res.body.refId);
  });

  it("a SUCCESSFUL callback is verified with MTN and issues the tickets once", async () => {
    const event = await seedEvent({ title: "Callback Fest" });
    const { refId } = (await start(event, event.packages[0])).body;

    fetchMock.mockResolvedValueOnce(momo({ access_token: "tok" })).mockResolvedValueOnce(momo(successful()));
    const cb = await api().post("/momo/callback").send(successful({ externalId: refId }));
    expect(cb.status).toBe(200);
    expect(await ticketModel.countDocuments()).toBe(1);

    // MTN may deliver the callback twice; the buyer may also still be polling.
    fetchMock.mockResolvedValueOnce(momo({ access_token: "tok" })).mockResolvedValueOnce(momo(successful()));
    await api().post("/momo/callback").send(successful({ externalId: refId }));
    const poll = await api().get(`/momo/statusOfRequest/${refId}`);
    expect(poll.body.status).toBe("SUCCESSFUL");
    expect(poll.body.tickets).toHaveLength(1);
    expect(await ticketModel.countDocuments()).toBe(1);
  });

  it("a callback is not trusted on its own: if MTN says PENDING nothing is issued", async () => {
    const event = await seedEvent();
    const { refId } = (await start(event, event.packages[0])).body;
    fetchMock.mockResolvedValueOnce(momo({ access_token: "tok" })).mockResolvedValueOnce(momo({ status: "PENDING" }));
    const cb = await api().post("/momo/callback").send(successful({ externalId: refId }));
    expect(cb.status).toBe(200);
    expect(await ticketModel.countDocuments()).toBe(0);
  });

  it("an unknown reference in a callback is a 404", async () => {
    const cb = await api().post("/momo/callback").send(successful({ externalId: "nope" }));
    expect(cb.status).toBe(404);
  });
});

describe("package capacity", () => {
  async function limitedEvent(capacity: number) {
    const owner = await registerOrganiser();
    const { body: event } = await api().post("/events").set("Authorization", `Bearer ${owner.token}`)
      .send(eventBody({ packages: [{ title: "Regular", price: 5000, currency: "RWF", capacity }] }));
    return { owner, event, pkg: event.packages[0] };
  }

  it("public event data shows how many tickets remain and derives soldOut", async () => {
    const { event, pkg } = await limitedEvent(2);
    let pub = await api().get(`/events/${event._id}`);
    expect(pub.body.packages[0].remaining).toBe(2);
    expect(pub.body.packages[0].soldOut).toBe(false);
    await start(event, pkg, 2);
    pub = await api().get(`/events/${event._id}`);
    expect(pub.body.packages[0].remaining).toBe(0);
    expect(pub.body.packages[0].soldOut).toBe(true);
    const list = await api().get("/events");
    expect(list.body.find((e: any) => e._id === event._id).packages[0].remaining).toBe(0);
  });

  it("a request beyond the remaining capacity is refused with 409", async () => {
    const { event, pkg } = await limitedEvent(3);
    expect((await start(event, pkg, 2)).status).toBe(202);
    const over = await start(event, pkg, 2);
    expect(over.status).toBe(409);
    expect(over.body.errorMessage).toMatch(/1 left/);
    fetchMock.mockReset();
    expect((await start(event, pkg, 1)).status).toBe(202);
  });

  it("a failed payment releases its reservation", async () => {
    const { event, pkg } = await limitedEvent(1);
    const { refId } = (await start(event, pkg, 1)).body;
    expect((await start(event, pkg, 1)).status).toBe(409);
    fetchMock.mockReset(); // the refused request never reached MTN, so its scripted responses are still queued
    fetchMock.mockResolvedValueOnce(momo({ access_token: "tok" })).mockResolvedValueOnce(momo({ status: "FAILED", reason: "PAYER_NOT_FOUND" }));
    await api().get(`/momo/statusOfRequest/${refId}`);
    expect((await start(event, pkg, 1)).status).toBe(202);
  });

  it("a stale pending payment releases its reservation after 30 minutes", async () => {
    const { event, pkg } = await limitedEvent(1);
    const { refId } = (await start(event, pkg, 1)).body;
    fetchMock.mockReset();
    await paymentModel.collection.updateOne({ refId }, { $set: { createdAt: new Date(Date.now() - 31 * 60 * 1000) } });
    expect((await start(event, pkg, 1)).status).toBe(202);
    const stale = await paymentModel.findOne({ refId });
    expect(stale!.status).toBe("EXPIRED");
  });

  it("packages without a capacity are unlimited", async () => {
    const event = await seedEvent();
    expect((await start(event, event.packages[0], 6)).status).toBe(202);
    const pub = await api().get(`/events/${event._id}`);
    expect(pub.body.packages[0].remaining).toBeNull();
  });

  it("organisers can set capacity when editing and cannot set it below what is sold", async () => {
    const { owner, event, pkg } = await limitedEvent(5);
    await start(event, pkg, 3);
    const tooLow = await api().put(`/events/${event._id}`).set("Authorization", `Bearer ${owner.token}`)
      .send({ packages: [{ _id: pkg._id, title: "Regular", price: 5000, capacity: 2 }] });
    expect(tooLow.status).toBe(400);
    const ok = await api().put(`/events/${event._id}`).set("Authorization", `Bearer ${owner.token}`)
      .send({ packages: [{ _id: pkg._id, title: "Regular", price: 5000, capacity: 10 }] });
    expect(ok.status).toBe(200);
    expect(ok.body.packages[0].capacity).toBe(10);
    expect(ok.body.packages[0].sold).toBe(3);
  });
});
