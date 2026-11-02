import mongoose from "mongoose";
import { eventModel } from "../models/events";
import { paymentModel, PaymentStatuses } from "../models/payments";
import { ticketModel } from "../models/tickets";
import { issueTickets, phoneFromPayload } from "./tickets";

export const STALE_PENDING_MINUTES = 30;
const TERMINAL_FAILURES = ["FAILED", "REJECTED", "EXPIRED", "TIMEOUT", "CANCELLED"];

/** PAYMENTS_MODE=mock skips MTN entirely: every request is treated as paid. Testing only. */
export const mockPayments = () => process.env.PAYMENTS_MODE === "mock";

export function mockStatus(payment: any) {
  const payload = payment.payload || {};
  return {
    mock: true,
    status: "SUCCESSFUL",
    amount: String(payload.amount ?? payment.ticketPackage?.price ?? 0),
    currency: payload.currency || payment.ticketPackage?.currency || "RWF",
    externalId: payload.externalId,
    payer: payload.payer,
    payerMessage: payload.payerMessage,
    financialTransactionId: `MOCK-${payment.refId.slice(0, 8)}`,
    reason: "Test mode: no payment was taken",
  };
}

/**
 * Atomically takes `quantity` seats on a package. Returns the number left when it cannot.
 * Packages without a capacity, or without an id, are unlimited.
 */
export async function reserveCapacity(eventId: any, packageId: any, quantity: number) {
  if (!eventId || !packageId || !mongoose.Types.ObjectId.isValid(String(packageId))) return { ok: true as const };
  const event = await eventModel.findOne({ _id: eventId, "packages._id": packageId }).select("packages");
  const pkg: any = event?.packages?.find((p: any) => String(p._id) === String(packageId));
  if (!pkg || typeof pkg.capacity !== "number") return { ok: true as const };

  const taken = await eventModel.updateOne(
    { _id: eventId, packages: { $elemMatch: { _id: packageId, sold: { $lte: pkg.capacity - quantity } } } },
    { $inc: { "packages.$.sold": quantity } }
  );
  if (taken.modifiedCount === 1) return { ok: true as const };
  const fresh = await eventModel.findOne({ _id: eventId, "packages._id": packageId }).select("packages");
  const now: any = fresh?.packages?.find((p: any) => String(p._id) === String(packageId));
  return { ok: false as const, remaining: Math.max(0, (now?.capacity ?? 0) - (now?.sold ?? 0)) };
}

async function releaseReservation(payment: any) {
  if (!payment.reserved) return;
  const packageId = payment.ticketPackage?._id;
  if (payment.event && packageId) {
    await eventModel.updateOne(
      { _id: payment.event, "packages._id": packageId },
      { $inc: { "packages.$.sold": -payment.quantity } }
    );
  }
  await paymentModel.updateOne({ _id: payment._id }, { $set: { reserved: false } });
}

/** Frees seats held by payments that never completed. Cheap enough to run before every new request. */
export async function releaseStalePayments() {
  const cutoff = new Date(Date.now() - STALE_PENDING_MINUTES * 60 * 1000);
  const stale = await paymentModel.find({ status: PaymentStatuses.pending, reserved: true, createdAt: { $lt: cutoff } });
  for (const payment of stale) {
    await paymentModel.updateOne({ _id: payment._id }, { $set: { status: PaymentStatuses.expired } });
    await releaseReservation(payment);
  }
  return stale.length;
}

export async function successfulResponse(payment: any) {
  const tickets = await ticketModel.find({ _id: { $in: payment.tickets || [] } });
  return { ...(payment.momoPayload || {}), status: "SUCCESSFUL", tickets };
}

/**
 * Applies a status reported by MTN (or the mock) to a payment record.
 * SUCCESSFUL claims the record atomically so tickets are issued exactly once,
 * whether the status came from the buyer polling or from MTN's callback.
 * Returns the body to send to a client.
 */
export async function settlePayment(payment: any, status: any): Promise<{ code: number; body: any }> {
  const refId = payment.refId;

  if (status?.status !== "SUCCESSFUL") {
    const failed = TERMINAL_FAILURES.includes(String(status?.status));
    await paymentModel.updateOne(
      { refId },
      { $set: { momoPayload: status, status: failed ? PaymentStatuses.failed : status?.status || payment.status } }
    );
    if (failed) await releaseReservation(payment);
    return { code: 200, body: status };
  }

  const claimed = await paymentModel.findOneAndUpdate(
    { refId, status: { $nin: [PaymentStatuses.successful, PaymentStatuses.issuing] } },
    { $set: { status: PaymentStatuses.issuing, momoPayload: status } },
    { new: true }
  );
  if (!claimed) {
    const current = await paymentModel.findOne({ refId });
    if (current?.status === PaymentStatuses.successful) return { code: 200, body: await successfulResponse(current) };
    return { code: 200, body: { ...status, status: "PENDING" } };
  }

  try {
    const tickets = await issueTickets({
      quantity: claimed.quantity,
      ticketPackage: claimed.ticketPackage,
      event: claimed.event,
      momoPayload: status,
      momoRef: refId,
      phone: phoneFromPayload(status) ?? phoneFromPayload(claimed.payload),
      buyer: claimed.buyer,
    });
    claimed.tickets = tickets.map((t) => t._id);
    claimed.status = PaymentStatuses.successful;
    claimed.issueError = undefined;
    await claimed.save();
    return { code: 200, body: { ...status, tickets } };
  } catch (err) {
    await paymentModel.updateOne({ refId }, { $set: { status: PaymentStatuses.pending, issueError: `${err}` } });
    return { code: 500, body: { errorMessage: `Payment succeeded but ticket issue failed: ${err}` } };
  }
}
