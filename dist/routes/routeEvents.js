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
var __rest = (this && this.__rest) || function (s, e) {
    var t = {};
    for (var p in s) if (Object.prototype.hasOwnProperty.call(s, p) && e.indexOf(p) < 0)
        t[p] = s[p];
    if (s != null && typeof Object.getOwnPropertySymbols === "function")
        for (var i = 0, p = Object.getOwnPropertySymbols(s); i < p.length; i++) {
            if (e.indexOf(p[i]) < 0 && Object.prototype.propertyIsEnumerable.call(s, p[i]))
                t[p[i]] = s[p[i]];
        }
    return t;
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const mongoose_1 = __importDefault(require("mongoose"));
const auth_1 = require("../middleware/auth");
const controllerEvents_1 = require("../controllers/controllerEvents");
const events_1 = require("../models/events");
const access_1 = require("../services/access");
const dashboard_1 = require("../services/dashboard");
const events_2 = require("../services/events");
const tickets_1 = require("../services/tickets");
const payments_1 = require("../services/payments");
const tickets_2 = require("../models/tickets");
const sms_1 = __importDefault(require("../services/sms"));
const format_1 = require("../services/format");
let router = (0, express_1.Router)();
const EDITABLE = ["imageUrl", "title", "date", "artist", "location", "description", "packages", "status", "published"];
const BROADCAST_MAX = 320;
/** Loads the event in :id and answers 404/403 itself when the caller may not manage it. */
function loadManagedEvent(req, res) {
    return __awaiter(this, void 0, void 0, function* () {
        const id = String(req.params.id);
        if (!mongoose_1.default.Types.ObjectId.isValid(id)) {
            res.status(404).send({ errorMessage: "Event not found" });
            return null;
        }
        const event = yield events_1.eventModel.findById(id);
        if (!event) {
            res.status(404).send({ errorMessage: "Event not found" });
            return null;
        }
        if (!(0, access_1.canManageEvent)(req.user, event)) {
            res.status(403).send({ errorMessage: "You do not manage this event" });
            return null;
        }
        return event;
    });
}
router.get("/", (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    res.send((yield (0, controllerEvents_1.getAllEvents)()).filter((e) => e.published !== false).map(events_2.publicEvent));
}));
/** Events the caller manages: their own for organisers, everything for admins. */
router.get("/mine", auth_1.ensureUserAuthorized, (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const filter = (0, access_1.seesEveryEvent)(req.user) ? {} : { owner: req.user._id };
    res.send(yield events_1.eventModel.find(filter).sort({ date: -1 }));
}));
router.get("/:id", (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const event = yield (0, controllerEvents_1.getEventById)(String(req.params.id));
        if (event && event.published !== false)
            res.send((0, events_2.publicEvent)(event));
        else
            res.status(404).send({ errorMessage: "Event not found" });
    }
    catch (err) {
        res.status(400).send({ errorMessage: `${err}` });
    }
}));
router.get("/:id/dashboard", auth_1.ensureUserAuthorized, (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const event = yield loadManagedEvent(req, res);
    if (!event)
        return;
    try {
        res.send(Object.assign({ event: (0, events_2.publicEvent)(event) }, (yield (0, dashboard_1.eventDashboard)(event._id))));
    }
    catch (err) {
        res.status(500).send({ errorMessage: `${err}` });
    }
}));
/** Free tickets issued by the organiser (guests, press, sponsors). They count against capacity, never as revenue. */
router.post("/:id/complimentary", auth_1.ensureUserAuthorized, (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const event = yield loadManagedEvent(req, res);
    if (!event)
        return;
    const { packageId, quantity, phone, note, email, name } = req.body || {};
    const pkg = event.packages.find((p) => String(p._id) === String(packageId));
    if (!pkg)
        return res.status(400).send({ errorMessage: "Choose a package of this event" });
    const qty = Math.max(1, Math.min(50, Math.floor(Number(quantity) || 1)));
    const reservation = yield (0, payments_1.reserveCapacity)(event._id, pkg._id, qty);
    if (!reservation.ok) {
        return res.status(409).send({ errorMessage: `Only ${reservation.remaining} left for ${pkg.title}`, remaining: reservation.remaining });
    }
    try {
        const tickets = yield (0, tickets_1.issueTickets)({
            quantity: qty,
            ticketPackage: pkg.toObject ? pkg.toObject() : pkg,
            event: event._id,
            phone,
            buyer: email || name ? { name, email } : undefined,
            complimentary: true,
            note,
        });
        res.status(201).send(tickets);
    }
    catch (err) {
        res.status(500).send({ errorMessage: `${err}` });
    }
}));
function csvCell(value) {
    const text = value === undefined || value === null ? "" : String(value);
    return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}
router.get("/:id/attendees.csv", auth_1.ensureUserAuthorized, (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a, _b, _c, _d, _e, _f;
    const event = yield loadManagedEvent(req, res);
    if (!event)
        return;
    const tickets = yield tickets_2.ticketModel.find({ event: event._id }).sort({ number: 1 });
    const rows = [["number", "package", "status", "phone", "buyer", "email", "amount", "purchased_at", "checked_in_at"]];
    for (const t of tickets) {
        rows.push([
            t.number,
            (_a = t.ticketPackage) === null || _a === void 0 ? void 0 : _a.title,
            t.status,
            (0, tickets_1.toInternational)((_c = (_b = t.momoPayload) === null || _b === void 0 ? void 0 : _b.payer) === null || _c === void 0 ? void 0 : _c.partyId) || "",
            (_d = t.buyer) === null || _d === void 0 ? void 0 : _d.name,
            (_e = t.buyer) === null || _e === void 0 ? void 0 : _e.email,
            t.complimentary ? 0 : (_f = t.momoPayload) === null || _f === void 0 ? void 0 : _f.amount,
            t.createdAt ? (0, format_1.formatStamp)(t.createdAt) : "",
            t.status === "consumed" && t.updatedAt ? (0, format_1.formatStamp)(t.updatedAt) : "",
        ].map(csvCell));
    }
    const name = `${event.title}`.replace(/[^a-z0-9]+/gi, "-").toLowerCase() || "event";
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="${name}-attendees.csv"`);
    res.send(rows.map((r) => r.join(",")).join("\n") + "\n");
}));
/** One SMS to every distinct ticket holder of the event, prefixed with the event title. */
router.post("/:id/broadcast", auth_1.ensureUserAuthorized, (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a, _b, _c;
    const event = yield loadManagedEvent(req, res);
    if (!event)
        return;
    const message = String(((_a = req.body) === null || _a === void 0 ? void 0 : _a.message) || "").trim();
    if (!message)
        return res.status(400).send({ errorMessage: "Write the message to send" });
    if (message.length > BROADCAST_MAX)
        return res.status(400).send({ errorMessage: `Keep the message under ${BROADCAST_MAX} characters` });
    const tickets = yield tickets_2.ticketModel.find({ event: event._id }).select("momoPayload.payer.partyId");
    const phones = new Set();
    for (const t of tickets) {
        const phone = (0, tickets_1.toInternational)((_c = (_b = t.momoPayload) === null || _b === void 0 ? void 0 : _b.payer) === null || _c === void 0 ? void 0 : _c.partyId);
        if (phone)
            phones.add(phone);
    }
    for (const phone of phones)
        (0, sms_1.default)(phone, `${event.title}: ${message}`, "EVENTIXR");
    res.send({ recipients: phones.size });
}));
router.post("/", auth_1.ensureUserAuthorized, (0, auth_1.requireRole)("admin", "organiser"), (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const _a = req.body || {}, { owner } = _a, fields = __rest(_a, ["owner"]);
        const doc = Object.assign(Object.assign({}, fields), { owner: req.user.role === "admin" && owner ? owner : req.user._id });
        res.status(201).send(yield (0, controllerEvents_1.createEvent)(doc));
    }
    catch (err) {
        res.status(400).send({ errorMessage: `${err}` });
    }
}));
router.put("/:id", auth_1.ensureUserAuthorized, (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a, _b;
    const event = yield loadManagedEvent(req, res);
    if (!event)
        return;
    const updates = {};
    for (const key of EDITABLE) {
        if (((_a = req.body) === null || _a === void 0 ? void 0 : _a[key]) !== undefined)
            updates[key] = req.body[key];
    }
    if (Array.isArray(updates.packages)) {
        const merged = (0, events_2.mergePackages)(event.packages, updates.packages);
        if (merged.error)
            return res.status(400).send({ errorMessage: merged.error });
        updates.packages = merged.packages;
    }
    if (req.user.role === "admin" && ((_b = req.body) === null || _b === void 0 ? void 0 : _b.owner))
        updates.owner = req.body.owner;
    try {
        const updated = yield events_1.eventModel.findByIdAndUpdate(event._id, { $set: updates }, { new: true, runValidators: true });
        res.send(updated);
    }
    catch (err) {
        res.status(400).send({ errorMessage: `${err}` });
    }
}));
exports.default = router;
