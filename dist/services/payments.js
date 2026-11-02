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
exports.mockPayments = exports.STALE_PENDING_MINUTES = void 0;
exports.mockStatus = mockStatus;
exports.reserveCapacity = reserveCapacity;
exports.releaseStalePayments = releaseStalePayments;
exports.successfulResponse = successfulResponse;
exports.settlePayment = settlePayment;
const mongoose_1 = __importDefault(require("mongoose"));
const events_1 = require("../models/events");
const payments_1 = require("../models/payments");
const tickets_1 = require("../models/tickets");
const tickets_2 = require("./tickets");
exports.STALE_PENDING_MINUTES = 30;
const TERMINAL_FAILURES = ["FAILED", "REJECTED", "EXPIRED", "TIMEOUT", "CANCELLED"];
/** PAYMENTS_MODE=mock skips MTN entirely: every request is treated as paid. Testing only. */
const mockPayments = () => process.env.PAYMENTS_MODE === "mock";
exports.mockPayments = mockPayments;
function mockStatus(payment) {
    var _a, _b, _c, _d;
    const payload = payment.payload || {};
    return {
        mock: true,
        status: "SUCCESSFUL",
        amount: String((_c = (_a = payload.amount) !== null && _a !== void 0 ? _a : (_b = payment.ticketPackage) === null || _b === void 0 ? void 0 : _b.price) !== null && _c !== void 0 ? _c : 0),
        currency: payload.currency || ((_d = payment.ticketPackage) === null || _d === void 0 ? void 0 : _d.currency) || "RWF",
        externalId: payload.externalId,
        payer: payload.payer,
        payerMessage: payload.payerMessage,
        financialTransactionId: `MOCK-${payment.refId.slice(0, 8)}`,
        reason: "Test mode: no payment was taken",
    };
}
/**
 * Atomically takes `quantity` seats on a package. Returns the number left when it cannot.
 * Packages without a capacity, or without an id, are unlimited.
 */
function reserveCapacity(eventId, packageId, quantity) {
    return __awaiter(this, void 0, void 0, function* () {
        var _a, _b, _c, _d;
        if (!eventId || !packageId || !mongoose_1.default.Types.ObjectId.isValid(String(packageId)))
            return { ok: true };
        const event = yield events_1.eventModel.findOne({ _id: eventId, "packages._id": packageId }).select("packages");
        const pkg = (_a = event === null || event === void 0 ? void 0 : event.packages) === null || _a === void 0 ? void 0 : _a.find((p) => String(p._id) === String(packageId));
        if (!pkg || typeof pkg.capacity !== "number")
            return { ok: true };
        const taken = yield events_1.eventModel.updateOne({ _id: eventId, packages: { $elemMatch: { _id: packageId, sold: { $lte: pkg.capacity - quantity } } } }, { $inc: { "packages.$.sold": quantity } });
        if (taken.modifiedCount === 1)
            return { ok: true };
        const fresh = yield events_1.eventModel.findOne({ _id: eventId, "packages._id": packageId }).select("packages");
        const now = (_b = fresh === null || fresh === void 0 ? void 0 : fresh.packages) === null || _b === void 0 ? void 0 : _b.find((p) => String(p._id) === String(packageId));
        return { ok: false, remaining: Math.max(0, ((_c = now === null || now === void 0 ? void 0 : now.capacity) !== null && _c !== void 0 ? _c : 0) - ((_d = now === null || now === void 0 ? void 0 : now.sold) !== null && _d !== void 0 ? _d : 0)) };
    });
}
function releaseReservation(payment) {
    return __awaiter(this, void 0, void 0, function* () {
        var _a;
        if (!payment.reserved)
            return;
        const packageId = (_a = payment.ticketPackage) === null || _a === void 0 ? void 0 : _a._id;
        if (payment.event && packageId) {
            yield events_1.eventModel.updateOne({ _id: payment.event, "packages._id": packageId }, { $inc: { "packages.$.sold": -payment.quantity } });
        }
        yield payments_1.paymentModel.updateOne({ _id: payment._id }, { $set: { reserved: false } });
    });
}
/** Frees seats held by payments that never completed. Cheap enough to run before every new request. */
function releaseStalePayments() {
    return __awaiter(this, void 0, void 0, function* () {
        const cutoff = new Date(Date.now() - exports.STALE_PENDING_MINUTES * 60 * 1000);
        const stale = yield payments_1.paymentModel.find({ status: payments_1.PaymentStatuses.pending, reserved: true, createdAt: { $lt: cutoff } });
        for (const payment of stale) {
            yield payments_1.paymentModel.updateOne({ _id: payment._id }, { $set: { status: payments_1.PaymentStatuses.expired } });
            yield releaseReservation(payment);
        }
        return stale.length;
    });
}
function successfulResponse(payment) {
    return __awaiter(this, void 0, void 0, function* () {
        const tickets = yield tickets_1.ticketModel.find({ _id: { $in: payment.tickets || [] } });
        return Object.assign(Object.assign({}, (payment.momoPayload || {})), { status: "SUCCESSFUL", tickets });
    });
}
/**
 * Applies a status reported by MTN (or the mock) to a payment record.
 * SUCCESSFUL claims the record atomically so tickets are issued exactly once,
 * whether the status came from the buyer polling or from MTN's callback.
 * Returns the body to send to a client.
 */
function settlePayment(payment, status) {
    return __awaiter(this, void 0, void 0, function* () {
        var _a;
        const refId = payment.refId;
        if ((status === null || status === void 0 ? void 0 : status.status) !== "SUCCESSFUL") {
            const failed = TERMINAL_FAILURES.includes(String(status === null || status === void 0 ? void 0 : status.status));
            yield payments_1.paymentModel.updateOne({ refId }, { $set: { momoPayload: status, status: failed ? payments_1.PaymentStatuses.failed : (status === null || status === void 0 ? void 0 : status.status) || payment.status } });
            if (failed)
                yield releaseReservation(payment);
            return { code: 200, body: status };
        }
        const claimed = yield payments_1.paymentModel.findOneAndUpdate({ refId, status: { $nin: [payments_1.PaymentStatuses.successful, payments_1.PaymentStatuses.issuing] } }, { $set: { status: payments_1.PaymentStatuses.issuing, momoPayload: status } }, { new: true });
        if (!claimed) {
            const current = yield payments_1.paymentModel.findOne({ refId });
            if ((current === null || current === void 0 ? void 0 : current.status) === payments_1.PaymentStatuses.successful)
                return { code: 200, body: yield successfulResponse(current) };
            return { code: 200, body: Object.assign(Object.assign({}, status), { status: "PENDING" }) };
        }
        try {
            const tickets = yield (0, tickets_2.issueTickets)({
                quantity: claimed.quantity,
                ticketPackage: claimed.ticketPackage,
                event: claimed.event,
                momoPayload: status,
                momoRef: refId,
                phone: (_a = (0, tickets_2.phoneFromPayload)(status)) !== null && _a !== void 0 ? _a : (0, tickets_2.phoneFromPayload)(claimed.payload),
                buyer: claimed.buyer,
            });
            claimed.tickets = tickets.map((t) => t._id);
            claimed.status = payments_1.PaymentStatuses.successful;
            claimed.issueError = undefined;
            yield claimed.save();
            return { code: 200, body: Object.assign(Object.assign({}, status), { tickets }) };
        }
        catch (err) {
            yield payments_1.paymentModel.updateOne({ refId }, { $set: { status: payments_1.PaymentStatuses.pending, issueError: `${err}` } });
            return { code: 500, body: { errorMessage: `Payment succeeded but ticket issue failed: ${err}` } };
        }
    });
}
