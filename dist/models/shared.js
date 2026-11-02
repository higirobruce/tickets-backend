"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.packageSchema = exports.Statuses = exports.Currencies = void 0;
const mongoose_1 = __importDefault(require("mongoose"));
var Currencies;
(function (Currencies) {
    Currencies["rwf"] = "RWF";
    Currencies["usd"] = "USD";
    Currencies["eur"] = "EUR";
})(Currencies || (exports.Currencies = Currencies = {}));
/** Lifecycle values shared by events and tickets. */
var Statuses;
(function (Statuses) {
    Statuses["pending"] = "pending";
    Statuses["ongoing"] = "ongoing";
    Statuses["expired"] = "expired";
    Statuses["cancelled"] = "cancelled";
    Statuses["postponed"] = "postponed";
    Statuses["upcoming"] = "upcoming";
    Statuses["consumed"] = "consumed";
    Statuses["sold"] = "sold";
})(Statuses || (exports.Statuses = Statuses = {}));
exports.packageSchema = new mongoose_1.default.Schema({
    title: { type: String },
    currency: { type: String, default: Currencies.rwf },
    price: { type: Number },
    soldOut: { type: Boolean, default: false },
    /** Maximum tickets for this package; unset means unlimited. */
    capacity: { type: Number },
    /** Tickets sold or reserved against the capacity. Maintained atomically by services/payments.ts. */
    sold: { type: Number, default: 0 },
});
