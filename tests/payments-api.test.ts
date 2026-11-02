import { describe, it, expect, vi } from "vitest";
import { settlePayment } from "../services/payments";
import { paymentModel } from "../models/payments";
import { ticketModel } from "../models/tickets";
import { seedEvent } from "./helpers";
vi.mock("../services/sms", () => ({ default: vi.fn() }));

describe("settlePayment with a normalised result", () => {
  it("successful issues once and stores the payment block on the ticket", async () => {
    const event = await seedEvent();
    const p = await paymentModel.create({ refId: "r1", provider: "lumicash", amount: 7000, currency: "BIF", phone: "25768191919", event: event._id, ticketPackage: event.packages[0], quantity: 1 });
    const first = await settlePayment(p, { outcome: "successful", providerRef: "LC-1", raw: { ResponseCode: "01" } });
    expect(first.code).toBe(200); expect(first.body.status).toBe("SUCCESSFUL"); expect(first.body.tickets).toHaveLength(1);
    const again = await settlePayment(await paymentModel.findOne({ refId: "r1" }), { outcome: "successful", providerRef: "LC-1", raw: {} });
    expect(again.body.tickets).toHaveLength(1);
    expect(await ticketModel.countDocuments()).toBe(1);
    const t: any = await ticketModel.findOne();
    expect(t.payment).toMatchObject({ provider: "lumicash", ref: "LC-1", amount: 7000, currency: "BIF", phone: "25768191919" });
    expect((await paymentModel.findOne({ refId: "r1" }))!.providerRef).toBe("LC-1");
  });
  it("failed marks the record FAILED with the reason and releases seats", async () => {
    const event = await seedEvent({ packages: [{ title: "Regular", price: 5000, currency: "RWF", capacity: 2, sold: 1 }] });
    const pkg: any = event.packages[0];
    const p = await paymentModel.create({ refId: "r2", provider: "lumicash", event: event._id, ticketPackage: pkg, quantity: 1, reserved: true });
    const r = await settlePayment(p, { outcome: "failed", reason: "Insufficient balance", raw: { ResponseCode: "10" } });
    expect(r.body).toMatchObject({ status: "FAILED", reason: "Insufficient balance" });
    expect((await paymentModel.findOne({ refId: "r2" }))!.status).toBe("FAILED");
    expect((await ticketModel.countDocuments())).toBe(0);
    const fresh: any = await (await import("../models/events")).eventModel.findById(event._id);
    expect(fresh.packages[0].sold).toBe(0);
  });
  it("pending stores the raw payload and issues nothing", async () => {
    const p = await paymentModel.create({ refId: "r3", provider: "momo" });
    const r = await settlePayment(p, { outcome: "pending", raw: { status: "PENDING" } });
    expect(r.body.status).toBe("PENDING");
    expect(await ticketModel.countDocuments()).toBe(0);
  });
});
