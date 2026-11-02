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
exports.getToken = getToken;
const crypto_1 = require("crypto");
const express_1 = require("express");
const payments_1 = require("../models/payments");
const auth_1 = require("../middleware/auth");
const tickets_1 = require("../services/tickets");
const payments_2 = require("../services/payments");
const sms_1 = __importDefault(require("../services/sms"));
let router = (0, express_1.Router)();
const momoBase = () => process.env.MOMO_BASE_URL || "";
const momoHeaders = (token) => (Object.assign(Object.assign({}, (token ? { Authorization: `Bearer ${token}` } : {})), { "Ocp-Apim-Subscription-Key": process.env.MOMO_SUBSCRIPTION_KEY || "", "X-Target-Environment": process.env.MOMO_ENVIRONMENT || "" }));
function upstreamError(res, err) {
    res.status(502).send({ errorMessage: `${err}` });
}
router.post("/getToken", auth_1.ensureUserAuthorized, (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        res.send(yield getToken());
    }
    catch (err) {
        upstreamError(res, err);
    }
}));
router.post("/requestToPay", (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a;
    const _b = req.body || {}, { eventId, event, ticketPackage, quantity, buyer } = _b, paymentPayload = __rest(_b, ["eventId", "event", "ticketPackage", "quantity", "buyer"]);
    if (!(paymentPayload === null || paymentPayload === void 0 ? void 0 : paymentPayload.amount) || !((_a = paymentPayload === null || paymentPayload === void 0 ? void 0 : paymentPayload.payer) === null || _a === void 0 ? void 0 : _a.partyId)) {
        return res.status(400).send({ errorMessage: "amount and payer.partyId are required" });
    }
    const refId = (0, crypto_1.randomUUID)();
    const qty = Math.max(1, Math.floor(Number(quantity) || 1));
    const targetEvent = eventId || event || undefined;
    // MTN echoes externalId back in the callback; that is how we find the payment again.
    paymentPayload.externalId = refId;
    try {
        yield (0, payments_2.releaseStalePayments)();
        const reservation = yield (0, payments_2.reserveCapacity)(targetEvent, ticketPackage === null || ticketPackage === void 0 ? void 0 : ticketPackage._id, qty);
        if (!reservation.ok) {
            return res.status(409).send({
                errorMessage: reservation.remaining
                    ? `Only ${reservation.remaining} left for ${(ticketPackage === null || ticketPackage === void 0 ? void 0 : ticketPackage.title) || "this package"}`
                    : `${(ticketPackage === null || ticketPackage === void 0 ? void 0 : ticketPackage.title) || "This package"} is sold out`,
                remaining: reservation.remaining,
            });
        }
        const record = {
            refId,
            payload: paymentPayload,
            event: targetEvent,
            ticketPackage,
            quantity: qty,
            reserved: Boolean(targetEvent && (ticketPackage === null || ticketPackage === void 0 ? void 0 : ticketPackage._id)),
            buyer: buyer ? { name: buyer.name, email: buyer.email } : undefined,
        };
        if ((0, payments_2.mockPayments)()) {
            yield payments_1.paymentModel.create(record);
            return res.status(202).send({ message: "Accepted (test mode, no payment taken)", refId, mock: true });
        }
        const { access_token } = yield getToken();
        const payment = yield payments_1.paymentModel.create(record);
        const response = yield fetch(`${momoBase()}/collection/v1_0/requesttopay`, {
            method: "POST",
            headers: Object.assign(Object.assign({}, momoHeaders(access_token)), { "X-Reference-Id": refId, "X-Callback-Url": `${(0, tickets_1.backendUrl)()}/momo/callback`, "Content-Type": "application/json" }),
            body: JSON.stringify(paymentPayload),
        });
        if (!response.ok) {
            yield (0, payments_2.settlePayment)(payment, { status: "FAILED", reason: response.statusText });
        }
        res.status(response.status).send({ message: response.statusText, refId });
    }
    catch (err) {
        upstreamError(res, err);
    }
}));
/** Looks the payment up with MTN (or the mock) and applies the result. */
function resolveAndSettle(payment, req) {
    return __awaiter(this, void 0, void 0, function* () {
        if (payment.status === payments_1.PaymentStatuses.successful) {
            return { code: 200, body: yield (0, payments_2.successfulResponse)(payment) };
        }
        if (payment.status === payments_1.PaymentStatuses.issuing) {
            return { code: 200, body: Object.assign(Object.assign({}, (payment.momoPayload || {})), { status: "PENDING" }) };
        }
        const status = (0, payments_2.mockPayments)() ? (0, payments_2.mockStatus)(payment) : yield fetchStatus(payment.refId);
        return (0, payments_2.settlePayment)(payment, status);
    });
}
router.get("/statusOfRequest/:refId", (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const refId = String(req.params.refId);
    try {
        let payment = yield payments_1.paymentModel.findOne({ refId });
        if (!payment) {
            if ((0, payments_2.mockPayments)())
                return res.status(404).send({ errorMessage: "Unknown payment reference" });
            // A client that started the payment before payment records existed.
            const { title, price, currency } = req.query;
            payment = yield payments_1.paymentModel.create({
                refId,
                ticketPackage: title
                    ? { title: String(title), price: Number(price), currency: currency ? String(currency) : undefined }
                    : undefined,
            });
        }
        const result = yield resolveAndSettle(payment, req);
        res.status(result.code).send(result.body);
    }
    catch (err) {
        upstreamError(res, err);
    }
}));
/**
 * MTN calls this when a payment reaches a final state. The body is never trusted on its own:
 * the status is re-read from MTN before anything is issued.
 */
const callback = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a;
    const body = req.body || {};
    const refId = body.externalId || body.referenceId;
    const payment = refId ? yield payments_1.paymentModel.findOne({ refId: String(refId) }) : null;
    if (!payment)
        return res.status(404).send({ errorMessage: "Unknown payment reference" });
    try {
        const result = yield resolveAndSettle(payment, req);
        res.status(result.code >= 500 ? 500 : 200).send({ received: true, status: (_a = result.body) === null || _a === void 0 ? void 0 : _a.status });
    }
    catch (err) {
        upstreamError(res, err);
    }
});
router.post("/callback", callback);
router.put("/callback", callback);
router.post("/sendSMS", auth_1.ensureUserAuthorized, (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const { partyId, ticketNumber, ticketPackage, eventTitle } = req.body;
    const to = (0, tickets_1.toInternational)(partyId);
    if (!to || !ticketNumber) {
        return res.status(400).send({ errorMessage: "partyId and ticketNumber are required" });
    }
    (0, sms_1.default)(to, (0, tickets_1.ticketSms)(eventTitle, Number(ticketNumber), ticketPackage), "EVENTIXR");
    res.send({ message: "done" });
}));
exports.default = router;
function fetchStatus(refId) {
    return __awaiter(this, void 0, void 0, function* () {
        const { access_token } = yield getToken();
        const response = yield fetch(`${momoBase()}/collection/v1_0/requesttopay/${refId}`, {
            method: "GET",
            headers: momoHeaders(access_token),
        });
        if (!response.ok)
            throw new Error(`MoMo responded ${response.status} ${response.statusText}`);
        return response.json();
    });
}
function getToken() {
    return __awaiter(this, void 0, void 0, function* () {
        const response = yield fetch(`${momoBase()}/collection/token/`, {
            method: "POST",
            headers: Object.assign({ Authorization: `Basic ${process.env.MOMO_BASIC_AUTH || ""}`, "X-Reference-Id": process.env.MOMO_API_USER || "" }, momoHeaders()),
        });
        if (!response.ok) {
            throw new Error(`MoMo token request failed: ${response.status} ${response.statusText}`);
        }
        return (yield response.json());
    });
}
