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
exports.eventDashboard = eventDashboard;
const mongoose_1 = __importDefault(require("mongoose"));
const tickets_1 = require("../models/tickets");
const events_1 = require("../models/events");
const amount = {
    $convert: { input: "$momoPayload.amount", to: "int", onError: 0, onNull: 0 },
};
const isPaid = { $cond: [{ $and: [{ $ifNull: ["$momoPayload", false] }, { $ne: ["$complimentary", true] }] }, 1, 0] };
const isConsumed = { $cond: [{ $eq: ["$status", events_1.Statuses.consumed] }, 1, 0] };
function eventDashboard(eventId) {
    return __awaiter(this, void 0, void 0, function* () {
        const match = { event: new mongoose_1.default.Types.ObjectId(String(eventId)) };
        const [totals] = yield tickets_1.ticketModel.aggregate([
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
        const byPackage = yield tickets_1.ticketModel.aggregate([
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
        const recent = yield tickets_1.ticketModel
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
    });
}
