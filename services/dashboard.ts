import mongoose from "mongoose";
import { ticketModel } from "../models/tickets";
import { Statuses } from "../models/events";

const amount = {
  $convert: { input: "$momoPayload.amount", to: "int", onError: 0, onNull: 0 },
};
const isPaid = { $cond: [{ $and: [{ $ifNull: ["$momoPayload", false] }, { $ne: ["$complimentary", true] }] }, 1, 0] };
const isConsumed = { $cond: [{ $eq: ["$status", Statuses.consumed] }, 1, 0] };

export interface PackageFigures {
  title: string;
  count: number;
  revenue: number;
  consumed: number;
}

export async function eventDashboard(eventId: any) {
  const match = { event: new mongoose.Types.ObjectId(String(eventId)) };

  const [totals] = await ticketModel.aggregate([
    { $match: match },
    {
      $group: {
        _id: null,
        tickets: { $sum: 1 },
        paid: { $sum: isPaid },
        revenue: { $sum: amount },
        consumed: { $sum: isConsumed },
      },
    },
  ]);

  const byPackage: PackageFigures[] = await ticketModel.aggregate([
    { $match: match },
    {
      $group: {
        _id: "$ticketPackage.title",
        count: { $sum: 1 },
        revenue: { $sum: amount },
        consumed: { $sum: isConsumed },
      },
    },
    { $project: { _id: 0, title: { $ifNull: ["$_id", "Unspecified"] }, count: 1, revenue: 1, consumed: 1 } },
    { $sort: { revenue: -1, title: 1 } },
  ]);

  const recent = await ticketModel
    .find(match)
    .sort({ createdAt: -1 })
    .limit(10)
    .select("number status ticketPackage.title momoPayload.amount momoPayload.payer.partyId createdAt updatedAt");

  const t = totals || { tickets: 0, paid: 0, revenue: 0, consumed: 0 };
  return {
    totals: {
      tickets: t.tickets,
      paid: t.paid,
      revenue: t.revenue,
      consumed: t.consumed,
      pending: t.tickets - t.consumed,
    },
    byPackage,
    recent,
  };
}
