import mongoose from "mongoose";
import { eventModel } from "../models/events";
import { paymentModel, PaymentStatuses } from "../models/payments";
import { ticketModel } from "../models/tickets";
import { issueTickets } from "./tickets";
import type { StatusResult } from "./providers/types";

export const STALE_PENDING_MINUTES = 30;

/** PAYMENTS_MODE=mock skips MTN entirely: every request is treated as paid. Testing only. Kept until the route moves to the registry. */
export const mockPayments = () => process.env.PAYMENTS_MODE === "mock";

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
 * Applies a provider's normalised status to a payment record.
 * A successful outcome claims the record atomically so tickets are issued exactly once,
 * whether the status came from the buyer polling or from the provider's callback.
 * Returns the body to send to a client; its `status` strings are the client contract.
 */
export async function settlePayment(payment: any, result: StatusResult): Promise<{ code: number; body: any }> {
  const refId = payment.refId;
  const raw = result.raw || {};

  if (result.outcome === "failed") {
    await paymentModel.updateOne({ refId }, { $set: { momoPayload: raw, status: PaymentStatuses.failed } });
    await releaseReservation(payment);
    return { code: 200, body: { ...raw, status: "FAILED", reason: result.reason } };
  }

  if (result.outcome === "pending") {
    await paymentModel.updateOne({ refId }, { $set: { momoPayload: raw } });
    return { code: 200, body: { ...raw, status: "PENDING" } };
  }

  const claimed = await paymentModel.findOneAndUpdate(
    { refId, status: { $nin: [PaymentStatuses.successful, PaymentStatuses.issuing] } },
    { $set: { status: PaymentStatuses.issuing, momoPayload: raw } },
    { returnDocument: "after" }
  );
  if (!claimed) {
    const current = await paymentModel.findOne({ refId });
    if (current?.status === PaymentStatuses.successful) return { code: 200, body: await successfulResponse(current) };
    return { code: 200, body: { ...raw, status: "PENDING" } };
  }

  const phone = result.payerPhone ?? claimed.phone ?? undefined;
  try {
    const tickets = await issueTickets({
      quantity: claimed.quantity,
      ticketPackage: claimed.ticketPackage,
      event: claimed.event,
      momoPayload: raw,
      momoRef: refId,
      phone,
      buyer: claimed.buyer,
      payment: {
        provider: claimed.provider,
        ref: result.providerRef,
        amount: result.amount ?? claimed.amount ?? undefined,
        currency: result.currency ?? claimed.currency ?? undefined,
        phone,
      },
    });
    claimed.tickets = tickets.map((t) => t._id);
    claimed.status = PaymentStatuses.successful;
    claimed.providerRef = result.providerRef;
    claimed.issueError = undefined;
    await claimed.save();
    return { code: 200, body: { ...raw, status: "SUCCESSFUL", tickets } };
  } catch (err) {
    await paymentModel.updateOne({ refId }, { $set: { status: PaymentStatuses.pending, issueError: `${err}` } });
    return { code: 500, body: { errorMessage: `Payment succeeded but ticket issue failed: ${err}`, refId } };
  }
}
