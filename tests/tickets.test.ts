import { describe, it, expect, vi, beforeEach } from "vitest";
import sendMessage from "../services/sms";
import { api, registerAndLogin, seedEvent } from "./helpers";
import { ticketModel } from "../models/tickets";

vi.mock("../services/sms", () => ({ default: vi.fn() }));

const smsMock = sendMessage as unknown as ReturnType<typeof vi.fn>;
beforeEach(() => smsMock.mockReset());

describe("ticket endpoints", () => {
  it("batch creation returns the saved tickets and sends no SMS to nobody", async () => {
    const { token } = await registerAndLogin();
    const event = await seedEvent();
    const res = await api()
      .post("/tickets/batch/3")
      .set("Authorization", `Bearer ${token}`)
      .send({ ticketPackage: { title: "VIP", price: 20000 }, event: String(event._id) });
    expect(res.status).toBe(201);
    expect(res.body).toHaveLength(3);
    expect(res.body[0].number).toBeTypeOf("number");
    expect(res.body.map((t: any) => t.number)).toEqual(
      Array.from(new Set(res.body.map((t: any) => t.number)))
    );
    expect(await ticketModel.countDocuments()).toBe(3);
    expect(smsMock).not.toHaveBeenCalled();
  });

  it("batch creation sends the SMS when a phone is given", async () => {
    const { token } = await registerAndLogin();
    const event = await seedEvent({ title: "Gospel Night Kigali" });
    await api()
      .post("/tickets/batch/2")
      .set("Authorization", `Bearer ${token}`)
      .send({ ticketPackage: { title: "VIP", price: 20000 }, event: String(event._id), phone: "250788000111" });
    expect(smsMock).toHaveBeenCalledTimes(2);
    expect(smsMock.mock.calls[0][0]).toBe("+250788000111");
    expect(smsMock.mock.calls[0][1]).toContain("Gospel Night Kigali");
  });

  it("re-issue from payload returns the saved tickets", async () => {
    const { token } = await registerAndLogin();
    const event = await seedEvent();
    const res = await api()
      .post("/tickets/fromPayload")
      .set("Authorization", `Bearer ${token}`)
      .send({
        quantity: 2,
        event: String(event._id),
        ticketPackage: { title: "Regular", price: 5000 },
        momoPayload: { payer: { partyId: "250788000222" }, amount: "10000" },
      });
    expect(res.status).toBe(201);
    expect(res.body).toHaveLength(2);
    expect(smsMock).toHaveBeenCalledTimes(2);
  });

  it("ticket listing filters by event instead of a hardcoded id", async () => {
    const { token } = await registerAndLogin();
    const a = await seedEvent({ title: "A" });
    const b = await seedEvent({ title: "B" });
    await ticketModel.create([
      { number: 1, qrCode: "x", event: a._id },
      { number: 2, qrCode: "x", event: b._id },
      { number: 3, qrCode: "x" },
    ]);
    const all = await api().get("/tickets").set("Authorization", `Bearer ${token}`);
    expect(all.body).toHaveLength(3);
    const onlyA = await api().get(`/tickets?event=${a._id}`).set("Authorization", `Bearer ${token}`);
    expect(onlyA.body.map((t: any) => t.number)).toEqual([1]);
  });

  it("validate and show redirect to the configured web host", async () => {
    await ticketModel.create({ number: 777, qrCode: "x" });
    const t = await ticketModel.findOne({ number: 777 });
    const validate = await api().get("/tickets/validate/777?showOnly=1");
    expect(validate.status).toBe(302);
    expect(validate.headers.location).toBe(`http://web.test/tickets/${t!._id}?showOnly=1`);
    const show = await api().get("/tickets/show/777");
    expect(show.headers.location).toBe(`http://web.test/tickets/${t!._id}?showOnly=1`);
  });

  it("tickets can be fetched by number", async () => {
    await ticketModel.create({ number: 888, qrCode: "x", ticketPackage: { title: "VIP", price: 1 } });
    const res = await api().get("/tickets/byNumber/888");
    expect(res.status).toBe(200);
    expect(res.body.number).toBe(888);
    expect((await api().get("/tickets/byNumber/1")).status).toBe(404);
  });

  it("consume records the logged-in user and is rejected anonymously", async () => {
    const { token, user } = await registerAndLogin();
    await ticketModel.create({ number: 999, qrCode: "x" });
    expect((await api().post("/tickets/consume/999")).status).toBe(401);
    const res = await api().post("/tickets/consume/999").set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("consumed");
    expect(res.body.consumedBy).toBe(user._id);
    const again = await api().post("/tickets/consume/999").set("Authorization", `Bearer ${token}`);
    expect(again.status).toBe(404);
  });

  it("summary counts every paid ticket regardless of date and can filter by event", async () => {
    const { token } = await registerAndLogin();
    const a = await seedEvent({ title: "A" });
    const b = await seedEvent({ title: "B" });
    await ticketModel.create([
      { number: 1, qrCode: "x", event: a._id, ticketPackage: { title: "VIP", price: 20000 }, momoPayload: { amount: "20000" }, createdAt: new Date("2023-01-01") },
      { number: 2, qrCode: "x", event: a._id, ticketPackage: { title: "VIP", price: 20000 }, momoPayload: { amount: "20000" } },
      { number: 3, qrCode: "x", event: b._id, ticketPackage: { title: "Regular", price: 5000 }, momoPayload: { amount: "5000" } },
    ]);
    const all = await api().get("/tickets/summary").set("Authorization", `Bearer ${token}`);
    expect(all.status).toBe(200);
    const vip = all.body.find((r: any) => r._id === "VIP");
    expect(vip.count).toBe(2);
    expect(vip.total).toBe(40000);
    const onlyB = await api().get(`/tickets/summary?event=${b._id}`).set("Authorization", `Bearer ${token}`);
    expect(onlyB.body).toHaveLength(1);
    expect(onlyB.body[0]._id).toBe("Regular");
  });
});
