import { ticketModel } from "../models/tickets";

/**
 * Shared Mongo expressions for every revenue report. Tickets carry the
 * provider-neutral `payment` block; older ones only have the raw MTN
 * `momoPayload` (amount as a string), so each expression reads the new
 * field first and falls back to the legacy one.
 */

const notComplimentary = { $ne: ["$complimentary", true] };

/** What the buyer paid, as a number; complimentary tickets earn nothing. */
export const paidAmount: any = {
  $cond: [
    notComplimentary,
    { $ifNull: ["$payment.amount", { $convert: { input: "$momoPayload.amount", to: "int", onError: 0, onNull: 0 } }] },
    0,
  ],
};

/** Legacy MoMo tickets have no currency of their own; the package's (or RWF) is what MTN charged. */
export const paidCurrency: any = { $ifNull: ["$payment.currency", "$ticketPackage.currency", "RWF"] };

/** 1 when the ticket was bought through a provider, 0 for unpaid or complimentary ones. */
export const isPaid: any = {
  $cond: [
    { $and: [{ $or: [{ $ifNull: ["$payment", false] }, { $ifNull: ["$momoPayload", false] }] }, notComplimentary] },
    1,
    0,
  ],
};

/** The number that paid, in MSISDN form. */
export const payerPhone: any = { $ifNull: ["$payment.phone", "$momoPayload.payer.partyId"] };

/** Revenue is never summed across currencies: one line per currency, largest first. */
export type Revenue = { currency: string; amount: number; tickets: number }[];

/** Paid tickets matching `match`, totalled per currency. */
export async function revenueByCurrency(match: any = {}): Promise<Revenue> {
  return ticketModel.aggregate([
    { $match: match },
    { $match: { $expr: { $eq: [isPaid, 1] } } },
    { $group: { _id: paidCurrency, amount: { $sum: paidAmount }, tickets: { $sum: 1 } } },
    { $project: { _id: 0, currency: "$_id", amount: 1, tickets: 1 } },
    { $sort: { amount: -1, currency: 1 } },
  ]);
}
