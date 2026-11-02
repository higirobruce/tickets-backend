"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getTicketsSummary = getTicketsSummary;
const express_1 = require("express");
const tickets_1 = require("../models/tickets");
const events_1 = require("../models/events");
const controllerTickets_1 = require("../controllers/controllerTickets");
const auth_1 = require("../middleware/auth");
const tickets_2 = require("../services/tickets");
const access_1 = require("../services/access");
const events_2 = require("../models/events");
const events_3 = require("../services/events");
let router = (0, express_1.Router)();
function ticketPage(ticket, showOnly) {
    const base = `${(0, tickets_2.webUrl)()}/tickets/${ticket._id}`;
    return showOnly ? `${base}?showOnly=1` : base;
}
function sendError(res, err, status = 500) {
    res.status(status).send({ errorMessage: `${err}` });
}
router.get("/", auth_1.ensureUserAuthorized, (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const event = typeof req.query.event === "string" ? req.query.event : undefined;
        const scope = yield (0, access_1.ticketScope)(req.user, event);
        if (!scope)
            return res.status(403).send({ errorMessage: "You do not manage this event" });
        res.send(yield (0, controllerTickets_1.getAllTickets)(scope));
    }
    catch (err) {
        sendError(res, err);
    }
}));
router.get("/show/:number", (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const ticket = yield (0, controllerTickets_1.getTicketByNumber)(Number(req.params.number));
    if (ticket)
        res.redirect(ticketPage(ticket, true));
    else
        res.status(404).send({ errorMessage: "Ticket not found" });
}));
router.get("/validate/:number", (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const ticket = yield (0, controllerTickets_1.getTicketByNumber)(Number(req.params.number));
    if (ticket)
        res.redirect(ticketPage(ticket, Boolean(req.query.showOnly)));
    else
        res.status(404).send({ errorMessage: "Ticket not found" });
}));
router.get("/byNumber/:number", (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const ticket = yield (0, controllerTickets_1.getTicketByNumber)(Number(req.params.number));
    if (ticket)
        res.send(ticket);
    else
        res.status(404).send({ errorMessage: "Ticket not found" });
}));
const sell = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a, _b;
    const number = parseInt(String(req.params.number));
    const momoRef = (_a = req.query.momoRef) !== null && _a !== void 0 ? _a : (_b = req.body) === null || _b === void 0 ? void 0 : _b.momoRef;
    const ticket = yield tickets_1.ticketModel.findOneAndUpdate({ number, status: events_1.Statuses.pending }, { $set: { status: events_1.Statuses.sold, momoRef } }, { new: true });
    if (ticket)
        res.send(ticket);
    else
        res.status(404).send({ errorMessage: "Ticket not found or already sold" });
});
router.get("/sell/:number", auth_1.ensureUserAuthorized, sell);
router.post("/sell/:number", auth_1.ensureUserAuthorized, sell);
const consume = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const number = parseInt(String(req.params.number));
    if (!(0, access_1.seesEveryEvent)(req.user)) {
        const existing = yield tickets_1.ticketModel.findOne({ number }).select("event");
        if (!existing)
            return res.status(404).send({ errorMessage: "Ticket not found" });
        const scope = yield (0, access_1.ticketScope)(req.user, existing.event ? String(existing.event) : "none");
        if (!scope)
            return res.status(403).send({ errorMessage: "This ticket is not for one of your events" });
    }
    const ticket = yield tickets_1.ticketModel.findOneAndUpdate({ number, status: { $in: [events_1.Statuses.pending, events_1.Statuses.sold] } }, { $set: { status: events_1.Statuses.consumed, consumedBy: req.user._id } }, { new: true });
    if (ticket)
        res.send(ticket);
    else
        res.status(404).send({ errorMessage: "Ticket not found or already consumed" });
});
router.get("/consume/:number", auth_1.ensureUserAuthorized, consume);
router.post("/consume/:number", auth_1.ensureUserAuthorized, consume);
/** Accepts a bare ticket number or the full link encoded in the QR code. */
function ticketNumberFromCode(code) {
    const text = decodeURIComponent(code);
    const fromUrl = text.match(/\/tickets\/(?:validate|show|byNumber)\/(\d+)/);
    const digits = fromUrl ? fromUrl[1] : text.trim();
    return /^\d+$/.test(digits) ? Number(digits) : null;
}
/** Gate scanning. GET looks a ticket up; POST admits it. Both answer with the ticket and its event. */
const scan = (admit) => (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a, _b;
    const number = ticketNumberFromCode(String(req.params.code));
    if (number === null)
        return res.status(400).send({ errorMessage: "That code is not a ticket" });
    const existing = yield tickets_1.ticketModel.findOne({ number });
    if (!existing)
        return res.status(404).send({ errorMessage: "Ticket not found" });
    if (!(0, access_1.seesEveryEvent)(req.user)) {
        const scope = yield (0, access_1.ticketScope)(req.user, existing.event ? String(existing.event) : "none");
        if (!scope)
            return res.status(403).send({ errorMessage: "This ticket is not for one of your events" });
    }
    const event = existing.event ? (0, events_3.publicEvent)(yield events_2.eventModel.findById(existing.event)) : null;
    if (!admit)
        return res.send({ ticket: existing, event, admitted: false });
    const ticket = yield tickets_1.ticketModel.findOneAndUpdate({ number, status: { $in: [events_1.Statuses.pending, events_1.Statuses.sold] } }, { $set: { status: events_1.Statuses.consumed, consumedBy: req.user._id } }, { new: true });
    if (!ticket) {
        return res.status(409).send({
            errorMessage: `Ticket already admitted at ${((_b = (_a = existing.updatedAt) === null || _a === void 0 ? void 0 : _a.toISOString) === null || _b === void 0 ? void 0 : _b.call(_a)) || "an earlier scan"}`,
            ticket: existing,
            event,
            admitted: false,
        });
    }
    res.send({ ticket, event, admitted: true });
});
router.get("/scan/:code", auth_1.ensureUserAuthorized, scan(false));
router.post("/scan/:code", auth_1.ensureUserAuthorized, scan(true));
router.get("/summary", auth_1.ensureUserAuthorized, (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const event = typeof req.query.event === "string" ? req.query.event : undefined;
        const from = typeof req.query.from === "string" ? new Date(req.query.from) : undefined;
        const scope = yield (0, access_1.ticketScope)(req.user, event);
        if (!scope)
            return res.status(403).send({ errorMessage: "You do not manage this event" });
        res.send(yield getTicketsSummary({ scope, from }));
    }
    catch (err) {
        sendError(res, err);
    }
}));
router.get("/:id", (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const ticket = yield (0, controllerTickets_1.getTicketById)(String(req.params.id));
        if (ticket)
            res.send(ticket);
        else
            res.status(404).send({ errorMessage: "Ticket not found" });
    }
    catch (err) {
        sendError(res, err, 400);
    }
}));
router.post("/", auth_1.ensureUserAuthorized, (0, auth_1.requireRole)("admin", "staff"), (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { ticketPackage, event, phone } = req.body;
        const [ticket] = yield (0, tickets_2.issueTickets)({ quantity: 1, ticketPackage, event, phone });
        res.status(201).send(ticket);
    }
    catch (err) {
        sendError(res, err);
    }
}));
router.post("/batch/:quantity", auth_1.ensureUserAuthorized, (0, auth_1.requireRole)("admin", "staff"), (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { ticketPackage, event, phone, momoPayload } = req.body;
        const tickets = yield (0, tickets_2.issueTickets)({
            quantity: parseInt(String(req.params.quantity)),
            ticketPackage,
            event,
            phone,
            momoPayload,
        });
        res.status(201).send(tickets);
    }
    catch (err) {
        sendError(res, err);
    }
}));
router.post("/fromPayload", auth_1.ensureUserAuthorized, (0, auth_1.requireRole)("admin", "staff"), (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { ticketPackage, momoPayload, quantity, event } = req.body;
        const tickets = yield (0, tickets_2.issueTickets)({
            quantity: parseInt(quantity) || 1,
            ticketPackage,
            event,
            momoPayload,
            momoRef: momoPayload === null || momoPayload === void 0 ? void 0 : momoPayload.referenceId,
        });
        res.status(201).send(tickets);
    }
    catch (err) {
        sendError(res, err);
    }
}));
exports.default = router;
function getTicketsSummary() {
    return __awaiter(this, arguments, void 0, function* (filter = {}) {
        const match = Object.assign({ momoPayload: { $ne: null } }, (filter.scope || {}));
        if (filter.from && !isNaN(filter.from.getTime()))
            match.createdAt = { $gte: filter.from };
        const pipeline = [
            { $match: match },
            {
                $group: {
                    _id: "$ticketPackage.title",
                    count: { $count: {} },
                    total: {
                        $sum: {
                            $convert: { input: "$momoPayload.amount", to: "int", onError: 0, onNull: 0 },
                        },
                    },
                },
            },
            { $sort: { _id: -1 } },
        ];
        return tickets_1.ticketModel.aggregate(pipeline);
    });
}
