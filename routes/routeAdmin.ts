import { Router } from "express";
import mongoose from "mongoose";
import { ensureUserAuthorized, publicUser, requireRole, ROLES } from "../middleware/auth";
import { userModel } from "../models/users";
import { eventModel } from "../models/events";
import { ticketModel } from "../models/tickets";
import { paymentModel } from "../models/payments";
import { checkPayment } from "../services/payments";
import { fail } from "./routePayments";
import { isPaid, paidAmount, paidCurrency, revenueByCurrency, Revenue } from "../services/reporting";

let router = Router();
router.use(ensureUserAuthorized, requireRole("admin"));

const isConsumed = { $cond: [{ $eq: ["$status", "consumed"] }, 1, 0] };

/** Adds one event's per-currency lines into an organiser's running Revenue. */
function addRevenue(into: Revenue, currency: string, amount: number, tickets: number) {
  const line = into.find((r) => r.currency === currency);
  if (line) {
    line.amount += amount;
    line.tickets += tickets;
  } else into.push({ currency, amount, tickets });
}

/** Platform-wide numbers plus one row per organiser. */
router.get("/overview", async (req, res) => {
  const [organisers, eventsCount, [ticketTotals], revenue, perEvent, recentEvents] = await Promise.all([
    userModel.find({ role: "organiser" }).select("-password -salt -reset").sort({ createdAt: -1 }),
    eventModel.countDocuments(),
    ticketModel.aggregate([
      { $group: { _id: null, tickets: { $sum: 1 }, paid: { $sum: isPaid }, consumed: { $sum: isConsumed } } },
    ]),
    revenueByCurrency(),
    ticketModel.aggregate([
      { $match: { event: { $ne: null } } },
      {
        $group: {
          _id: { event: "$event", currency: paidCurrency },
          tickets: { $sum: 1 },
          paid: { $sum: isPaid },
          amount: { $sum: paidAmount },
        },
      },
    ]),
    eventModel.find().sort({ createdAt: -1 }).limit(10).populate("owner", "organisation email firstName lastName"),
  ]);

  const statsByEvent = new Map<string, any[]>();
  for (const p of perEvent as any[]) {
    const key = String(p._id.event);
    statsByEvent.set(key, [...(statsByEvent.get(key) || []), p]);
  }

  const events = await eventModel.find().select("owner");
  const byOwner = new Map<string, { events: number; tickets: number; revenue: Revenue }>();
  for (const e of events as any[]) {
    const key = String(e.owner || "");
    const row = byOwner.get(key) || { events: 0, tickets: 0, revenue: [] };
    row.events += 1;
    for (const stats of statsByEvent.get(String(e._id)) || []) {
      row.tickets += stats.tickets;
      // Unpaid tickets still form a currency group; they add no revenue line.
      if (stats.paid) addRevenue(row.revenue, stats._id.currency, stats.amount, stats.paid);
    }
    byOwner.set(key, row);
  }
  for (const row of byOwner.values()) row.revenue.sort((a, b) => b.amount - a.amount);

  const t = ticketTotals || { tickets: 0, paid: 0, consumed: 0 };
  res.send({
    totals: { organisers: organisers.length, events: eventsCount, tickets: t.tickets, paid: t.paid, revenue, consumed: t.consumed },
    organisers: organisers.map((o: any) => ({
      ...publicUser(o),
      ...(byOwner.get(String(o._id)) || { events: 0, tickets: 0, revenue: [] }),
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

/** Payment ledger for support. `select` is an allowlist so request/response payloads (which hold credentials) never leave the server. */
router.get("/payments", async (req, res, next) => {
  const { status, provider } = req.query;
  const filter: Record<string, string> = {};
  if (typeof status === "string" && status) filter.status = status;
  if (typeof provider === "string" && provider) filter.provider = provider;
  const asked = Number(req.query.limit);
  const limit = Number.isInteger(asked) && asked > 0 ? Math.min(asked, 200) : 50;
  try {
    const payments = await paymentModel
      .find(filter)
      .select("refId provider providerRef status amount currency phone event quantity issueError createdAt updatedAt")
      .sort({ createdAt: -1 })
      .limit(limit);
    res.send({ payments });
  } catch (err) {
    next(err);
  }
});

/** Re-check a stuck payment with its provider and settle it (issues the ticket on success). */
router.post("/payments/:refId/verify", async (req, res, next) => {
  try {
    const r = await checkPayment(String(req.params.refId));
    res.status(r.code).send(r.body);
  } catch (err) {
    fail(res, next, err);
  }
});

export default router;
