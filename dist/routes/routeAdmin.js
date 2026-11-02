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
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const mongoose_1 = __importDefault(require("mongoose"));
const auth_1 = require("../middleware/auth");
const users_1 = require("../models/users");
const events_1 = require("../models/events");
const tickets_1 = require("../models/tickets");
let router = (0, express_1.Router)();
router.use(auth_1.ensureUserAuthorized, (0, auth_1.requireRole)("admin"));
const amount = { $convert: { input: "$momoPayload.amount", to: "int", onError: 0, onNull: 0 } };
const isPaid = { $cond: [{ $and: [{ $ifNull: ["$momoPayload", false] }, { $ne: ["$complimentary", true] }] }, 1, 0] };
const paidAmount = { $cond: [{ $ne: ["$complimentary", true] }, amount, 0] };
const isConsumed = { $cond: [{ $eq: ["$status", "consumed"] }, 1, 0] };
/** Platform-wide numbers plus one row per organiser. */
router.get("/overview", (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const [organisers, eventsCount, [ticketTotals], perEvent, recentEvents] = yield Promise.all([
        users_1.userModel.find({ role: "organiser" }).select("-password -salt -reset").sort({ createdAt: -1 }),
        events_1.eventModel.countDocuments(),
        tickets_1.ticketModel.aggregate([
            { $group: { _id: null, tickets: { $sum: 1 }, paid: { $sum: isPaid }, revenue: { $sum: paidAmount }, consumed: { $sum: isConsumed } } },
        ]),
        tickets_1.ticketModel.aggregate([
            { $match: { event: { $ne: null } } },
            { $group: { _id: "$event", tickets: { $sum: 1 }, revenue: { $sum: paidAmount } } },
        ]),
        events_1.eventModel.find().sort({ createdAt: -1 }).limit(10).populate("owner", "organisation email firstName lastName"),
    ]);
    const events = yield events_1.eventModel.find().select("owner");
    const byOwner = new Map();
    const statsByEvent = new Map(perEvent.map((p) => [String(p._id), p]));
    for (const e of events) {
        const key = String(e.owner || "");
        const row = byOwner.get(key) || { events: 0, tickets: 0, revenue: 0 };
        const stats = statsByEvent.get(String(e._id));
        row.events += 1;
        row.tickets += (stats === null || stats === void 0 ? void 0 : stats.tickets) || 0;
        row.revenue += (stats === null || stats === void 0 ? void 0 : stats.revenue) || 0;
        byOwner.set(key, row);
    }
    const t = ticketTotals || { tickets: 0, paid: 0, revenue: 0, consumed: 0 };
    res.send({
        totals: { organisers: organisers.length, events: eventsCount, tickets: t.tickets, paid: t.paid, revenue: t.revenue, consumed: t.consumed },
        organisers: organisers.map((o) => (Object.assign(Object.assign({}, (0, auth_1.publicUser)(o)), (byOwner.get(String(o._id)) || { events: 0, tickets: 0, revenue: 0 })))),
        recentEvents,
    });
}));
router.put("/users/:id", (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a;
    const id = String(req.params.id);
    const role = (_a = req.body) === null || _a === void 0 ? void 0 : _a.role;
    if (!mongoose_1.default.Types.ObjectId.isValid(id))
        return res.status(404).send({ errorMessage: "User not found" });
    if (!auth_1.ROLES.includes(role))
        return res.status(400).send({ errorMessage: `Role must be one of ${auth_1.ROLES.join(", ")}` });
    const user = yield users_1.userModel.findByIdAndUpdate(id, { $set: { role } }, { new: true });
    if (!user)
        return res.status(404).send({ errorMessage: "User not found" });
    res.send((0, auth_1.publicUser)(user));
}));
exports.default = router;
