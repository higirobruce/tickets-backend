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
exports.TICKET_NUMBER_START = void 0;
exports.backendUrl = backendUrl;
exports.webUrl = webUrl;
exports.validateUrl = validateUrl;
exports.nextTicketNumber = nextTicketNumber;
exports.ticketSms = ticketSms;
exports.phoneFromPayload = phoneFromPayload;
exports.toInternational = toInternational;
exports.issueTickets = issueTickets;
const qrcode_1 = __importDefault(require("qrcode"));
const tickets_1 = require("../models/tickets");
const events_1 = require("../models/events");
const controllerTickets_1 = __importDefault(require("../controllers/controllerTickets"));
const sms_1 = __importDefault(require("../services/sms"));
const email_1 = require("./email");
exports.TICKET_NUMBER_START = 10000000;
const DUPLICATE_KEY = 11000;
const MAX_NUMBER_RETRIES = 5;
function backendUrl() {
    return (process.env.TICKETS_BCKEND_URL || "http://localhost:8081").replace(/\/$/, "");
}
/** Public web app that ticket links and QR redirects point at. */
function webUrl() {
    return (process.env.TICKETS_WEB_URL || "https://www.eventixr.com").replace(/\/$/, "");
}
function validateUrl(number, showOnly = false) {
    const base = `${backendUrl()}/tickets/validate/${number}`;
    return showOnly ? `${base}?showOnly=1` : base;
}
function nextTicketNumber() {
    return __awaiter(this, void 0, void 0, function* () {
        var _a;
        const last = yield tickets_1.ticketModel.findOne().sort({ number: -1 }).select("number");
        return Math.max(exports.TICKET_NUMBER_START, ((_a = last === null || last === void 0 ? void 0 : last.number) !== null && _a !== void 0 ? _a : 0) + 1);
    });
}
function ticketSms(eventTitle, number, ticketPackage) {
    var _a;
    const greeting = eventTitle ? `Ikaze mu gitaramo ${eventTitle}.` : "Ikaze.";
    const price = (ticketPackage === null || ticketPackage === void 0 ? void 0 : ticketPackage.price) != null
        ? ` - igura ${ticketPackage.price} ${ticketPackage.currency || "RWF"}`
        : "";
    return `${greeting} Itike yanyu ${number} mwayibona aha ${validateUrl(number, true)}. Mwaguze ${(_a = ticketPackage === null || ticketPackage === void 0 ? void 0 : ticketPackage.title) !== null && _a !== void 0 ? _a : ""} ticket${price}`;
}
function phoneFromPayload(momoPayload) {
    var _a;
    const partyId = (_a = momoPayload === null || momoPayload === void 0 ? void 0 : momoPayload.payer) === null || _a === void 0 ? void 0 : _a.partyId;
    return partyId ? String(partyId) : undefined;
}
function toInternational(phone) {
    if (!phone)
        return undefined;
    const digits = String(phone).replace(/[^\d]/g, "");
    return digits ? `+${digits}` : undefined;
}
/**
 * Creates `quantity` tickets, waits for every save, then sends one SMS per
 * ticket when there is a phone to send to. Returns the saved documents.
 */
function issueTickets(options) {
    return __awaiter(this, void 0, void 0, function* () {
        var _a, _b, _c;
        const quantity = Math.max(1, Math.floor(Number(options.quantity) || 1));
        const eventDoc = options.event ? yield events_1.eventModel.findById(options.event) : null;
        const eventId = (_a = eventDoc === null || eventDoc === void 0 ? void 0 : eventDoc._id) !== null && _a !== void 0 ? _a : (options.event || undefined);
        const phone = toInternational((_b = options.phone) !== null && _b !== void 0 ? _b : phoneFromPayload(options.momoPayload));
        const saved = [];
        for (let i = 0; i < quantity; i++) {
            saved.push(yield createWithFreshNumber({
                ticketPackage: options.ticketPackage,
                event: eventId,
                momoPayload: options.momoPayload,
                momoRef: options.momoRef,
                buyer: options.buyer || undefined,
                complimentary: Boolean(options.complimentary),
                note: options.note,
            }));
        }
        if (phone) {
            for (const ticket of saved) {
                (0, sms_1.default)(phone, ticketSms(eventDoc === null || eventDoc === void 0 ? void 0 : eventDoc.title, ticket.number, options.ticketPackage), "EVENTIXR");
            }
        }
        const email = (_c = options.buyer) === null || _c === void 0 ? void 0 : _c.email;
        if (email && (0, email_1.emailConfigured)()) {
            for (const ticket of saved) {
                yield (0, email_1.sendTicketEmail)(email, ticket, eventDoc);
            }
        }
        return saved;
    });
}
function createWithFreshNumber(fields) {
    return __awaiter(this, void 0, void 0, function* () {
        for (let attempt = 0; attempt < MAX_NUMBER_RETRIES; attempt++) {
            const number = yield nextTicketNumber();
            const qrCode = yield qrcode_1.default.toDataURL(validateUrl(number));
            try {
                return yield (0, controllerTickets_1.default)(Object.assign({ number, qrCode }, fields));
            }
            catch (err) {
                if ((err === null || err === void 0 ? void 0 : err.code) !== DUPLICATE_KEY)
                    throw err;
            }
        }
        throw new Error("Could not allocate a unique ticket number");
    });
}
