import { Router, Request, Response } from "express";
import mongoose from "mongoose";
import { ensureUserAuthorized, requireRole } from "../middleware/auth";
import { createEvent, getAllEvents, getEventById } from "../controllers/controllerEvents";
import { eventModel } from "../models/events";
import { canManageEvent, seesEveryEvent } from "../services/access";
import { eventDashboard } from "../services/dashboard";
import { mergePackages, publicEvent } from "../services/events";
import { issueTickets, toInternational } from "../services/tickets";
import { reserveCapacity } from "../services/payments";
import { ticketModel } from "../models/tickets";
import sendMessage from "../services/sms";
import { formatStamp } from "../services/format";

let router = Router();

const EDITABLE = ["imageUrl", "title", "date", "artist", "location", "description", "packages", "status", "published"] as const;
const BROADCAST_MAX = 320;

/** Loads the event in :id and answers 404/403 itself when the caller may not manage it. */
async function loadManagedEvent(req: Request, res: Response) {
  const id = String(req.params.id);
  if (!mongoose.Types.ObjectId.isValid(id)) {
    res.status(404).send({ errorMessage: "Event not found" });
    return null;
  }
  const event = await eventModel.findById(id);
  if (!event) {
    res.status(404).send({ errorMessage: "Event not found" });
    return null;
  }
  if (!canManageEvent(req.user!, event)) {
    res.status(403).send({ errorMessage: "You do not manage this event" });
    return null;
  }
  return event;
}

router.get("/", async (req, res) => {
  res.send((await getAllEvents()).filter((e: any) => e.published !== false).map(publicEvent));
});

/** Events the caller manages: their own for organisers, everything for admins. */
router.get("/mine", ensureUserAuthorized, async (req, res) => {
  const filter = seesEveryEvent(req.user!) ? {} : { owner: req.user!._id };
  res.send(await eventModel.find(filter).sort({ date: -1 }));
});

router.get("/:id", async (req, res) => {
  try {
    const event = await getEventById(String(req.params.id));
    if (event && event.published !== false) res.send(publicEvent(event));
    else res.status(404).send({ errorMessage: "Event not found" });
  } catch (err) {
    res.status(400).send({ errorMessage: `${err}` });
  }
});

router.get("/:id/dashboard", ensureUserAuthorized, async (req, res) => {
  const event = await loadManagedEvent(req, res);
  if (!event) return;
  try {
    res.send({ event: publicEvent(event), ...(await eventDashboard(event._id)) });
  } catch (err) {
    res.status(500).send({ errorMessage: `${err}` });
  }
});

/** Free tickets issued by the organiser (guests, press, sponsors). They count against capacity, never as revenue. */
router.post("/:id/complimentary", ensureUserAuthorized, async (req, res) => {
  const event = await loadManagedEvent(req, res);
  if (!event) return;
  const { packageId, quantity, phone, note, email, name } = req.body || {};
  const pkg: any = (event.packages as any[]).find((p) => String(p._id) === String(packageId));
  if (!pkg) return res.status(400).send({ errorMessage: "Choose a package of this event" });
  const qty = Math.max(1, Math.min(50, Math.floor(Number(quantity) || 1)));
  const reservation = await reserveCapacity(event._id, pkg._id, qty);
  if (!reservation.ok) {
    return res.status(409).send({ errorMessage: `Only ${reservation.remaining} left for ${pkg.title}`, remaining: reservation.remaining });
  }
  try {
    const tickets = await issueTickets({
      quantity: qty,
      ticketPackage: pkg.toObject ? pkg.toObject() : pkg,
      event: event._id,
      phone,
      buyer: email || name ? { name, email } : undefined,
      complimentary: true,
      note,
    });
    res.status(201).send(tickets);
  } catch (err) {
    res.status(500).send({ errorMessage: `${err}` });
  }
});

function csvCell(value: any) {
  const text = value === undefined || value === null ? "" : String(value);
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

router.get("/:id/attendees.csv", ensureUserAuthorized, async (req, res) => {
  const event = await loadManagedEvent(req, res);
  if (!event) return;
  const tickets = await ticketModel.find({ event: event._id }).sort({ number: 1 });
  const rows = [["number", "package", "status", "phone", "buyer", "email", "amount", "purchased_at", "checked_in_at"]];
  for (const t of tickets as any[]) {
    rows.push([
      t.number,
      t.ticketPackage?.title,
      t.status,
      toInternational(t.momoPayload?.payer?.partyId) || "",
      t.buyer?.name,
      t.buyer?.email,
      t.complimentary ? 0 : t.momoPayload?.amount,
      t.createdAt ? formatStamp(t.createdAt) : "",
      t.status === "consumed" && t.updatedAt ? formatStamp(t.updatedAt) : "",
    ].map(csvCell));
  }
  const name = `${event.title}`.replace(/[^a-z0-9]+/gi, "-").toLowerCase() || "event";
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="${name}-attendees.csv"`);
  res.send(rows.map((r) => r.join(",")).join("\n") + "\n");
});

/** One SMS to every distinct ticket holder of the event, prefixed with the event title. */
router.post("/:id/broadcast", ensureUserAuthorized, async (req, res) => {
  const event = await loadManagedEvent(req, res);
  if (!event) return;
  const message = String(req.body?.message || "").trim();
  if (!message) return res.status(400).send({ errorMessage: "Write the message to send" });
  if (message.length > BROADCAST_MAX) return res.status(400).send({ errorMessage: `Keep the message under ${BROADCAST_MAX} characters` });
  const tickets = await ticketModel.find({ event: event._id }).select("momoPayload.payer.partyId");
  const phones = new Set<string>();
  for (const t of tickets as any[]) {
    const phone = toInternational(t.momoPayload?.payer?.partyId);
    if (phone) phones.add(phone);
  }
  for (const phone of phones) sendMessage(phone, `${event.title}: ${message}`, "EVENTIXR");
  res.send({ recipients: phones.size });
});

router.post("/", ensureUserAuthorized, requireRole("admin", "organiser"), async (req, res) => {
  try {
    const { owner, ...fields } = req.body || {};
    const doc = {
      ...fields,
      owner: req.user!.role === "admin" && owner ? owner : req.user!._id,
    };
    res.status(201).send(await createEvent(doc));
  } catch (err) {
    res.status(400).send({ errorMessage: `${err}` });
  }
});

router.put("/:id", ensureUserAuthorized, async (req, res) => {
  const event = await loadManagedEvent(req, res);
  if (!event) return;
  const updates: any = {};
  for (const key of EDITABLE) {
    if (req.body?.[key] !== undefined) updates[key] = req.body[key];
  }
  if (Array.isArray(updates.packages)) {
    const merged = mergePackages(event.packages as any[], updates.packages);
    if (merged.error) return res.status(400).send({ errorMessage: merged.error });
    updates.packages = merged.packages;
  }
  if (req.user!.role === "admin" && req.body?.owner) updates.owner = req.body.owner;
  try {
    const updated = await eventModel.findByIdAndUpdate(
      event._id,
      { $set: updates },
      { new: true, runValidators: true }
    );
    res.send(updated);
  } catch (err) {
    res.status(400).send({ errorMessage: `${err}` });
  }
});

export default router;
