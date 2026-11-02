import { Router } from "express";
import mongoose from "mongoose";
import { ensureUserAuthorized, publicUser, requireRole, ROLES } from "../middleware/auth";
import { userModel } from "../models/users";
import { eventModel } from "../models/events";
import { ticketModel } from "../models/tickets";

let router = Router();
router.use(ensureUserAuthorized, requireRole("admin"));

const amount = { $convert: { input: "$momoPayload.amount", to: "int", onError: 0, onNull: 0 } };
const isPaid = { $cond: [{ $and: [{ $ifNull: ["$momoPayload", false] }, { $ne: ["$complimentary", true] }] }, 1, 0] };
const paidAmount = { $cond: [{ $ne: ["$complimentary", true] }, amount, 0] };
const isConsumed = { $cond: [{ $eq: ["$status", "consumed"] }, 1, 0] };

/** Platform-wide numbers plus one row per organiser. */
router.get("/overview", async (req, res) => {
  const [organisers, eventsCount, [ticketTotals], perEvent, recentEvents] = await Promise.all([
    userModel.find({ role: "organiser" }).select("-password -salt -reset").sort({ createdAt: -1 }),
    eventModel.countDocuments(),
    ticketModel.aggregate([
      { $group: { _id: null, tickets: { $sum: 1 }, paid: { $sum: isPaid }, revenue: { $sum: paidAmount }, consumed: { $sum: isConsumed } } },
    ]),
    ticketModel.aggregate([
      { $match: { event: { $ne: null } } },
      { $group: { _id: "$event", tickets: { $sum: 1 }, revenue: { $sum: paidAmount } } },
    ]),
    eventModel.find().sort({ createdAt: -1 }).limit(10).populate("owner", "organisation email firstName lastName"),
  ]);

  const events = await eventModel.find().select("owner");
  const byOwner = new Map<string, { events: number; tickets: number; revenue: number }>();
  const statsByEvent = new Map(perEvent.map((p: any) => [String(p._id), p]));
  for (const e of events as any[]) {
    const key = String(e.owner || "");
    const row = byOwner.get(key) || { events: 0, tickets: 0, revenue: 0 };
    const stats: any = statsByEvent.get(String(e._id));
    row.events += 1;
    row.tickets += stats?.tickets || 0;
    row.revenue += stats?.revenue || 0;
    byOwner.set(key, row);
  }

  const t = ticketTotals || { tickets: 0, paid: 0, revenue: 0, consumed: 0 };
  res.send({
    totals: { organisers: organisers.length, events: eventsCount, tickets: t.tickets, paid: t.paid, revenue: t.revenue, consumed: t.consumed },
    organisers: organisers.map((o: any) => ({
      ...publicUser(o),
      ...(byOwner.get(String(o._id)) || { events: 0, tickets: 0, revenue: 0 }),
    })),
    recentEvents,
  });
});

router.put("/users/:id", async (req, res) => {
  const id = String(req.params.id);
  const role = req.body?.role;
  if (!mongoose.Types.ObjectId.isValid(id)) return res.status(404).send({ errorMessage: "User not found" });
  if (!ROLES.includes(role)) return res.status(400).send({ errorMessage: `Role must be one of ${ROLES.join(", ")}` });
  const user = await userModel.findByIdAndUpdate(id, { $set: { role } }, { new: true });
  if (!user) return res.status(404).send({ errorMessage: "User not found" });
  res.send(publicUser(user));
});

export default router;
