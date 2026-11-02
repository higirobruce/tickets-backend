import { randomUUID } from "crypto";
import mongoose from "mongoose";
import { eventModel, Statuses } from "../models/events";
import { paymentModel, PaymentStatuses } from "../models/payments";
import { ticketModel } from "../models/tickets";
// Called through the namespace so tests can make ticket issuing fail on demand.
import * as ticketService from "./tickets";
import { getProvider } from "./providers/registry";
import { ProviderError } from "./providers/types";
import type { StatusResult } from "./providers/types";

export const STALE_PENDING_MINUTES = 30;
/** An ISSUING record untouched this long is assumed orphaned by a crash and may be reclaimed. */
export const ISSUING_RECLAIM_MINUTES = 2;
/** A stale Lumicash payment is re-verified at most this often... */
export const STALE_VERIFY_INTERVAL_MINUTES = 10;
/** ...and at most this many per sweep, so one sweep cannot hammer the provider. */
export const STALE_VERIFY_BATCH = 3;

/** Rethrows anything a provider call throws as a ProviderError, so routes can tell upstream faults from ours. */
export async function callProvider<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    throw err instanceof ProviderError ? err : new ProviderError(`${err instanceof Error ? err.message : err}`);
  }
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

/** Claims the reservation flag first, so concurrent releases of one payment free its seats only once. */
export async function releaseReservation(payment: any) {
  const claimed = await paymentModel.updateOne({ _id: payment._id, reserved: true }, { $set: { reserved: false } });
  if (claimed.modifiedCount !== 1) return;
  const packageId = payment.ticketPackage?._id;
  if (payment.event && packageId) {
    await eventModel.updateOne(
      { _id: payment.event, "packages._id": packageId },
      { $inc: { "packages.$.sold": -payment.quantity } }
    );
  }
}

/**
 * Frees seats held by payments that never completed. MoMo/mock expiry is cheap and runs inline.
 * Lumicash verification can take several provider round trips, so by default it runs in the
 * background and never delays the request that triggered the sweep; tests pass awaitVerify.
 */
export async function releaseStalePayments({ awaitVerify = false }: { awaitVerify?: boolean } = {}) {
  const cutoff = new Date(Date.now() - STALE_PENDING_MINUTES * 60 * 1000);
  const stale = await paymentModel
    .find({ status: PaymentStatuses.pending, reserved: true, createdAt: { $lt: cutoff } })
    .sort({ _id: 1 });
  const verifyCutoff = new Date(Date.now() - STALE_VERIFY_INTERVAL_MINUTES * 60 * 1000);
  const toVerify = stale
    .filter((p) => p.provider === "lumicash" && !(p.lastVerifiedAt && p.lastVerifiedAt >= verifyCutoff))
    .sort((a, b) => (a.lastVerifiedAt?.getTime() ?? 0) - (b.lastVerifiedAt?.getTime() ?? 0))
    .slice(0, STALE_VERIFY_BATCH);

  let released = 0;
  for (const payment of stale) {
    if (payment.provider === "lumicash") continue;
    if (await expireAndRelease(payment)) released++;
  }

  const verifying = verifyStaleLumicash(toVerify, verifyCutoff);
  if (awaitVerify) return released + (await verifying);
  verifying.catch(() => console.error("Background Lumicash stale verification failed"));
  return released;
}

/** Conditional, so a payment that settled meanwhile is neither expired nor released. */
async function expireAndRelease(payment: any) {
  const expired = await paymentModel.updateOne(
    { _id: payment._id, status: PaymentStatuses.pending },
    { $set: { status: PaymentStatuses.expired } }
  );
  if (expired.modifiedCount !== 1) return false;
  await releaseReservation(payment);
  return true;
}

/**
 * A Lumicash cashout is synchronous, so a stale pending one may already have debited the wallet.
 * Only a verify that says failed lets it expire; one that says successful issues the tickets;
 * anything else leaves it for an admin to resolve. Returns how many were expired.
 */
async function verifyStaleLumicash(payments: any[], verifyCutoff: Date) {
  let released = 0;
  for (const payment of payments) {
    try {
      const outcome = await verifyStale(payment, verifyCutoff);
      if (outcome === "failed" && (await expireAndRelease(payment))) released++;
    } catch {
      console.error(`Stale verification failed for refId ${payment.refId}`);
    }
  }
  return released;
}

/** Stamping lastVerifiedAt first means concurrent sweeps never verify the same payment twice. */
async function verifyStale(payment: any, verifyCutoff: Date) {
  const provider = getProvider("lumicash");
  if (!provider) return "pending";
  const stamped = await paymentModel.updateOne(
    { _id: payment._id, $or: [{ lastVerifiedAt: null }, { lastVerifiedAt: { $lt: verifyCutoff } }] },
    { $set: { lastVerifiedAt: new Date() } }
  );
  if (stamped.modifiedCount !== 1) return "pending";
  let result: StatusResult;
  try {
    result = await provider.status(payment);
  } catch {
    return "pending";
  }
  // The wallet was debited: settle so the buyer gets tickets rather than waiting on an admin.
  if (result.outcome === "successful") await settlePayment(payment, result);
  return result.outcome;
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
    // Only a pending payment can fail: a paid, issuing, failed or expired one keeps its first outcome.
    const marked = await paymentModel.updateOne(
      { refId, status: PaymentStatuses.pending },
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

  await retakeReleasedSeats(claimed);

  const phone = result.payerPhone ?? claimed.phone ?? undefined;
  try {
    // A crash mid-issue leaves some tickets behind; reuse them so a retry never issues twice.
    const existing = await ticketModel.find({ momoRef: refId }).sort({ number: 1 });
    const shortfall = Math.max(0, claimed.quantity - existing.length);
    const created = shortfall === 0 ? [] : await ticketService.issueTickets({
      quantity: shortfall,
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
    const tickets = [...existing, ...created];
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

/**
 * A payment that expired or failed gave its seats back. If the provider later says it was paid,
 * the buyer still gets tickets, so the seats are taken again even past capacity (money first).
 */
async function retakeReleasedSeats(claimed: any) {
  const packageId = claimed.ticketPackage?._id;
  if (claimed.reserved || !claimed.event || !packageId) return;
  const hasCapacity = await eventModel.exists({
    _id: claimed.event,
    packages: { $elemMatch: { _id: packageId, capacity: { $type: "number" } } },
  });
  if (!hasCapacity) return;
  const flagged = await paymentModel.updateOne({ _id: claimed._id, reserved: false }, { $set: { reserved: true } });
  if (flagged.modifiedCount !== 1) return;
  claimed.reserved = true;
  await eventModel.updateOne(
    { _id: claimed.event, "packages._id": packageId },
    { $inc: { "packages.$.sold": claimed.quantity } }
  );
  console.warn(`Late success re-took released seats for refId ${claimed.refId}`);
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
  // Legacy events have no `published` field and count as published.
  if (event.published === false || event.status === Statuses.cancelled) return badRequest("This event is not on sale");
  if (event.date && event.date.getTime() < Date.now()) return badRequest("This event has ended");
  if (pkg.soldOut) return { code: 409, body: { errorMessage: `${pkg.title} is sold out` } };
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

  const result = await callProvider(() => provider.start({ refId, amount, currency, phone, description }));
  if (result.outcome === "pending") {
    await paymentModel.updateOne({ refId }, { $set: { momoPayload: result.raw } });
    return { code: 202, body: { refId, status: "PENDING", ...(provider.id === "mock" ? { mock: true } : {}) } };
  }
  const settled = await settlePayment(payment, result);
  if (settled.code >= 500) return { code: settled.code, body: { refId, ...settled.body } };
  return { code: result.outcome === "failed" ? 402 : 200, body: { refId, ...settled.body } };
}

/**
 * Re-reads a payment's state from its provider and applies it. A provider failure is
 * thrown as a ProviderError, which callers map to 502.
 */
export async function checkPayment(refId: string): Promise<{ code: number; body: any }> {
  const payment = await paymentModel.findOne({ refId: String(refId) });
  if (!payment) return { code: 404, body: { errorMessage: "Unknown payment reference" } };
  if (payment.status === PaymentStatuses.successful) {
    return { code: 200, body: await successfulResponse(payment) };
  }
  if (payment.status === PaymentStatuses.issuing) {
    // An issuer that crashed mid-issue leaves ISSUING behind; after a grace period anyone may take over.
    const cutoff = new Date(Date.now() - ISSUING_RECLAIM_MINUTES * 60 * 1000);
    const reclaimed = await paymentModel.updateOne(
      { refId: payment.refId, status: PaymentStatuses.issuing, updatedAt: { $lt: cutoff } },
      { $set: { status: PaymentStatuses.pending } }
    );
    if (reclaimed.modifiedCount !== 1) {
      return { code: 200, body: { ...(payment.momoPayload || {}), status: "PENDING" } };
    }
    console.warn(`Reclaimed a stuck ISSUING payment, refId ${payment.refId}`);
    payment.status = PaymentStatuses.pending;
  }
  const provider = getProvider(payment.provider);
  if (!provider) return { code: 409, body: { errorMessage: "Payment method no longer available" } };
  return settlePayment(payment, await callProvider(() => provider.status(payment)));
}
