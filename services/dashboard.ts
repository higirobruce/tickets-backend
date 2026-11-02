import mongoose from "mongoose";
import { ticketModel } from "../models/tickets";
import { Statuses } from "../models/events";
import { isPaid, paidAmount, paidCurrency, revenueByCurrency } from "./reporting";

const isConsumed = { $cond: [{ $eq: ["$status", Statuses.consumed] }, 1, 0] };

export interface PackageFigures {
  title: string;
  currency: string;
  count: number;
  revenue: number;
  consumed: number;
}

export async function eventDashboard(eventId: any) {
  const match = { event: new mongoose.Types.ObjectId(String(eventId)) };

  const [[totals], revenue] = await Promise.all([
    ticketModel.aggregate([
      { $match: match },
      { $group: { _id: null, tickets: { $sum: 1 }, paid: { $sum: isPaid }, consumed: { $sum: isConsumed } } },
    ]),
    revenueByCurrency(match),
  ]);

  // A package title can be sold in more than one currency, so each pair is its own row.
  const byPackage: PackageFigures[] = await ticketModel.aggregate([
    { $match: match },
    {
      $group: {
        _id: { title: "$ticketPackage.title", currency: paidCurrency },
        count: { $sum: 1 },
        revenue: { $sum: paidAmount },
        consumed: { $sum: isConsumed },
      },
    },
    {
      $project: {
        _id: 0,
        title: { $ifNull: ["$_id.title", "Unspecified"] },
        currency: "$_id.currency",
        count: 1,
        revenue: 1,
        consumed: 1,
      },
    },
    { $sort: { revenue: -1, title: 1 } },
  ]);

  const recent = await ticketModel
    .find(match)
    .sort({ createdAt: -1 })
    .limit(10)
    .select("number status ticketPackage.title payment momoPayload.amount momoPayload.payer.partyId createdAt updatedAt");

  const t = totals || { tickets: 0, paid: 0, consumed: 0 };
  return {
    totals: {
      tickets: t.tickets,
      paid: t.paid,
      revenue,
      consumed: t.consumed,
      pending: t.tickets - t.consumed,
    },
    byPackage,
    recent,
  };
}
