import { randomUUID } from "crypto";
import mongoose from "mongoose";
import { eventModel } from "../models/events";
import { paymentModel, PaymentStatuses } from "../models/payments";
import { ticketModel } from "../models/tickets";
// Called through the namespace so tests can make ticket issuing fail on demand.
import * as ticketService from "./tickets";
import { getProvider } from "./providers/registry";
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
  const stale = await paymentModel
    .find({ status: PaymentStatuses.pending, reserved: true, createdAt: { $lt: cutoff } })
    .sort({ _id: 1 });
  let released = 0;
  for (const payment of stale) {
    if (payment.provider === "lumicash" && !(await lumicashConfirmsFailed(payment))) continue;
    await paymentModel.updateOne({ _id: payment._id }, { $set: { status: PaymentStatuses.expired } });
    await releaseReservation(payment);
    released++;
  }
  return released;
}

/**
 * A Lumicash cashout is synchronous, so a stale pending one may already have debited the wallet.
 * Only a verify that says failed lets it expire; anything else leaves it for an admin to resolve.
 */
async function lumicashConfirmsFailed(payment: any) {
  const provider = getProvider("lumicash");
  if (!provider) return false;
  try {
    return (await provider.status(payment)).outcome === "failed";
  } catch {
    return false;
  }
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
    // A late or replayed failure must never undo a payment that is already paid or being issued.
    const marked = await paymentModel.updateOne(
      { refId, status: { $nin: [PaymentStatuses.successful, PaymentStatuses.issuing] } },
      { $set: { momoPayload: raw, status: PaymentStatuses.failed } }
    );
    if (marked.modifiedCount === 1) await releaseReservation(payment);
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
    const tickets = await ticketService.issueTickets({
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
        // Mongoose rejects NaN, which would leave a paid buyer without tickets.
        amount: Number.isFinite(result.amount) ? result.amount : claimed.amount ?? undefined,
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

export const MAX_QUANTITY = 6;

/** Whole tickets only, at least one and at most MAX_QUANTITY, whatever the client sent. */
export function normaliseQuantity(q: unknown): number {
  const n = Math.floor(Number(q));
  if (Number.isNaN(n)) return 1;
  return Math.min(MAX_QUANTITY, Math.max(1, n));
}

export interface StartRequest {
  provider: string;
  eventId: string;
  packageId: string;
  quantity: unknown;
  phone: string;
  buyer?: { name?: string; email?: string };
}

const badRequest = (errorMessage: string) => ({ code: 400, body: { errorMessage } });

/**
 * Starts a payment for a package of a stored event. The amount is always the stored
 * price times the quantity, so a client can never choose what it pays.
 */
export async function startPayment(r: StartRequest): Promise<{ code: number; body: any }> {
  const provider = getProvider(String(r.provider));
  if (!provider) return badRequest(`Payment method ${r.provider} is not available`);

  const event = mongoose.Types.ObjectId.isValid(String(r.eventId)) ? await eventModel.findById(String(r.eventId)) : null;
  const pkgDoc: any = event?.packages?.find((p: any) => String(p._id) === String(r.packageId));
  if (!event || !pkgDoc || typeof pkgDoc.price !== "number") return badRequest("Choose a ticket package");
  const pkg = pkgDoc.toObject();
  const currency = String(pkg.currency || "");
  if (provider.currencies.length && !provider.currencies.includes(currency)) {
    return badRequest(`${provider.label} cannot take ${currency}`);
  }

  let phone: string | undefined;
  if (provider.phone) {
    // Validated exactly as sent: the client owns formatting, so anything else is a client bug to surface.
    if (typeof r.phone !== "string" || !new RegExp(provider.phone.pattern).test(r.phone)) {
      return badRequest(provider.phone.hint);
    }
    phone = provider.phone.countryCode + r.phone;
  }

  const quantity = normaliseQuantity(r.quantity);
  await releaseStalePayments();
  const reservation = await reserveCapacity(event._id, pkg._id, quantity);
  if (!reservation.ok) {
    return {
      code: 409,
      body: {
        errorMessage: reservation.remaining ? `Only ${reservation.remaining} left for ${pkg.title}` : `${pkg.title} is sold out`,
        remaining: reservation.remaining,
      },
    };
  }

  const refId = randomUUID();
  const amount = pkg.price * quantity;
  const description = `${quantity} x ${pkg.title} for ${event.title}`;
  const payment = await paymentModel.create({
    refId,
    provider: provider.id,
    amount,
    currency,
    phone,
    event: event._id,
    ticketPackage: pkg,
    quantity,
    reserved: typeof pkg.capacity === "number",
    buyer: r.buyer ? { name: r.buyer.name, email: r.buyer.email } : undefined,
    payload: { description },
  });

  const result = await provider.start({ refId, amount, currency, phone, description });
  if (result.outcome === "pending") {
    await paymentModel.updateOne({ refId }, { $set: { momoPayload: result.raw } });
    return { code: 202, body: { refId, status: "PENDING", ...(provider.id === "mock" ? { mock: true } : {}) } };
  }
  const settled = await settlePayment(payment, result);
  if (settled.code >= 500) return { code: settled.code, body: { refId, ...settled.body } };
  return { code: result.outcome === "failed" ? 402 : 200, body: { refId, ...settled.body } };
}

/**
 * Re-reads a payment's state from its provider and applies it. Callers map a thrown
 * provider error to 502.
 */
export async function checkPayment(refId: string): Promise<{ code: number; body: any }> {
  const payment = await paymentModel.findOne({ refId: String(refId) });
  if (!payment) return { code: 404, body: { errorMessage: "Unknown payment reference" } };
  if (payment.status === PaymentStatuses.successful) {
    return { code: 200, body: await successfulResponse(payment) };
  }
  if (payment.status === PaymentStatuses.issuing) {
    return { code: 200, body: { ...(payment.momoPayload || {}), status: "PENDING" } };
  }
  const provider = getProvider(payment.provider);
  if (!provider) return { code: 409, body: { errorMessage: "Payment method no longer available" } };
  return settlePayment(payment, await provider.status(payment));
}
