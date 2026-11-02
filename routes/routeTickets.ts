import { Router, Request, Response } from "express";
import mongoose from "mongoose";
import { ticketModel } from "../models/tickets";
import { Statuses } from "../models/events";
import {
  getAllTickets,
  getTicketById,
  getTicketByNumber,
} from "../controllers/controllerTickets";
import { ensureUserAuthorized, requireRole } from "../middleware/auth";
import { issueTickets, webUrl } from "../services/tickets";
import { seesEveryEvent, ticketScope } from "../services/access";
import { eventModel } from "../models/events";
import { publicEvent } from "../services/events";
import { paidAmount, paidCurrency } from "../services/reporting";

let router = Router();

function ticketPage(ticket: any, showOnly: boolean) {
  const base = `${webUrl()}/tickets/${ticket._id}`;
  return showOnly ? `${base}?showOnly=1` : base;
}

function sendError(res: Response, err: unknown, status = 500) {
  res.status(status).send({ errorMessage: `${err}` });
}

router.get("/", ensureUserAuthorized, async (req, res) => {
  try {
    const event = typeof req.query.event === "string" ? req.query.event : undefined;
    const scope = await ticketScope(req.user!, event);
    if (!scope) return res.status(403).send({ errorMessage: "You do not manage this event" });
    res.send(await getAllTickets(scope));
  } catch (err) {
    sendError(res, err);
  }
});

router.get("/show/:number", async (req, res) => {
  const ticket = await getTicketByNumber(Number(req.params.number));
  if (ticket) res.redirect(ticketPage(ticket, true));
  else res.status(404).send({ errorMessage: "Ticket not found" });
});

router.get("/validate/:number", async (req, res) => {
  const ticket = await getTicketByNumber(Number(req.params.number));
  if (ticket) res.redirect(ticketPage(ticket, Boolean(req.query.showOnly)));
  else res.status(404).send({ errorMessage: "Ticket not found" });
});

router.get("/byNumber/:number", async (req, res) => {
  const ticket = await getTicketByNumber(Number(req.params.number));
  if (ticket) res.send(ticket);
  else res.status(404).send({ errorMessage: "Ticket not found" });
});

const sell = async (req: Request, res: Response) => {
  const number = parseInt(String(req.params.number));
  const momoRef = req.query.momoRef ?? req.body?.momoRef;
  const ticket = await ticketModel.findOneAndUpdate(
    { number, status: Statuses.pending },
    { $set: { status: Statuses.sold, momoRef } },
    { new: true }
  );
  if (ticket) res.send(ticket);
  else res.status(404).send({ errorMessage: "Ticket not found or already sold" });
};
router.get("/sell/:number", ensureUserAuthorized, sell);
router.post("/sell/:number", ensureUserAuthorized, sell);

const consume = async (req: Request, res: Response) => {
  const number = parseInt(String(req.params.number));
  if (!seesEveryEvent(req.user!)) {
    const existing = await ticketModel.findOne({ number }).select("event");
    if (!existing) return res.status(404).send({ errorMessage: "Ticket not found" });
    const scope = await ticketScope(req.user!, existing.event ? String(existing.event) : "none");
    if (!scope) return res.status(403).send({ errorMessage: "This ticket is not for one of your events" });
  }
  const ticket = await ticketModel.findOneAndUpdate(
    { number, status: { $in: [Statuses.pending, Statuses.sold] } },
    { $set: { status: Statuses.consumed, consumedBy: req.user!._id } },
    { new: true }
  );
  if (ticket) res.send(ticket);
  else res.status(404).send({ errorMessage: "Ticket not found or already consumed" });
};
router.get("/consume/:number", ensureUserAuthorized, consume);
router.post("/consume/:number", ensureUserAuthorized, consume);

/** Accepts a bare ticket number or the full link encoded in the QR code. */
function ticketNumberFromCode(code: string) {
  const text = decodeURIComponent(code);
  const fromUrl = text.match(/\/tickets\/(?:validate|show|byNumber)\/(\d+)/);
  const digits = fromUrl ? fromUrl[1] : text.trim();
  return /^\d+$/.test(digits) ? Number(digits) : null;
}

/** Gate scanning. GET looks a ticket up; POST admits it. Both answer with the ticket and its event. */
const scan = (admit: boolean) => async (req: Request, res: Response) => {
  const number = ticketNumberFromCode(String(req.params.code));
  if (number === null) return res.status(400).send({ errorMessage: "That code is not a ticket" });
  const existing = await ticketModel.findOne({ number });
  if (!existing) return res.status(404).send({ errorMessage: "Ticket not found" });
  if (!seesEveryEvent(req.user!)) {
    const scope = await ticketScope(req.user!, existing.event ? String(existing.event) : "none");
    if (!scope) return res.status(403).send({ errorMessage: "This ticket is not for one of your events" });
  }
  const event = existing.event ? publicEvent(await eventModel.findById(existing.event)) : null;
  if (!admit) return res.send({ ticket: existing, event, admitted: false });

  const ticket = await ticketModel.findOneAndUpdate(
    { number, status: { $in: [Statuses.pending, Statuses.sold] } },
    { $set: { status: Statuses.consumed, consumedBy: req.user!._id } },
    { new: true }
  );
  if (!ticket) {
    return res.status(409).send({
      errorMessage: `Ticket already admitted at ${existing.updatedAt?.toISOString?.() || "an earlier scan"}`,
      ticket: existing,
      event,
      admitted: false,
    });
  }
  res.send({ ticket, event, admitted: true });
};
router.get("/scan/:code", ensureUserAuthorized, scan(false));
router.post("/scan/:code", ensureUserAuthorized, scan(true));

router.get("/summary", ensureUserAuthorized, async (req, res) => {
  try {
    const event = typeof req.query.event === "string" ? req.query.event : undefined;
    const from = typeof req.query.from === "string" ? new Date(req.query.from) : undefined;
    const scope = await ticketScope(req.user!, event);
    if (!scope) return res.status(403).send({ errorMessage: "You do not manage this event" });
    res.send(await getTicketsSummary({ scope, from }));
  } catch (err) {
    sendError(res, err);
  }
});

router.get("/:id", async (req, res) => {
  try {
    const ticket = await getTicketById(String(req.params.id));
    if (ticket) res.send(ticket);
    else res.status(404).send({ errorMessage: "Ticket not found" });
  } catch (err) {
    sendError(res, err, 400);
  }
});

router.post("/", ensureUserAuthorized, requireRole("admin", "staff"), async (req, res) => {
  try {
    const { ticketPackage, event, phone } = req.body;
    const [ticket] = await issueTickets({ quantity: 1, ticketPackage, event, phone });
    res.status(201).send(ticket);
  } catch (err) {
    sendError(res, err);
  }
});

router.post("/batch/:quantity", ensureUserAuthorized, requireRole("admin", "staff"), async (req, res) => {
  try {
    const { ticketPackage, event, phone, momoPayload } = req.body;
    const tickets = await issueTickets({
      quantity: parseInt(String(req.params.quantity)),
      ticketPackage,
      event,
      phone,
      momoPayload,
    });
    res.status(201).send(tickets);
  } catch (err) {
    sendError(res, err);
  }
});

router.post("/fromPayload", ensureUserAuthorized, requireRole("admin", "staff"), async (req, res) => {
  try {
    const { ticketPackage, momoPayload, quantity, event } = req.body;
    const tickets = await issueTickets({
      quantity: parseInt(quantity) || 1,
      ticketPackage,
      event,
      momoPayload,
      momoRef: momoPayload?.referenceId,
    });
    res.status(201).send(tickets);
  } catch (err) {
    sendError(res, err);
  }
});

export default router;

/** Paid tickets per package and currency; amounts in different currencies are never added together. */
export async function getTicketsSummary(filter: { scope?: any; from?: Date } = {}) {
  const match: any = { $or: [{ payment: { $ne: null } }, { momoPayload: { $ne: null } }], ...(filter.scope || {}) };
  if (filter.from && !isNaN(filter.from.getTime())) match.createdAt = { $gte: filter.from };

  return ticketModel.aggregate([
    { $match: match },
    { $group: { _id: { title: "$ticketPackage.title", currency: paidCurrency }, count: { $count: {} }, total: { $sum: paidAmount } } },
    { $project: { _id: 0, title: "$_id.title", currency: "$_id.currency", count: 1, total: 1 } },
    { $sort: { title: -1, currency: 1 } },
  ]);
}
