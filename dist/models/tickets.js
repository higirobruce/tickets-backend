"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.ticketModel = exports.ticketSchema = exports.packageSchema = exports.Statuses = exports.Currencies = void 0;
const mongoose_1 = __importDefault(require("mongoose"));
var Currencies;
(function (Currencies) {
    Currencies["rwf"] = "RWF";
    Currencies["usd"] = "USD";
    Currencies["eur"] = "EUR";
})(Currencies || (exports.Currencies = Currencies = {}));
var Statuses;
(function (Statuses) {
    Statuses["pending"] = "pending";
    Statuses["ongoing"] = "ongoing";
    Statuses["expired"] = "expired";
    Statuses["cancelled"] = "cancelled";
    Statuses["posponed"] = "postponed";
    Statuses["upcoming"] = "upcoming";
    Statuses["consumed"] = "consumed";
})(Statuses || (exports.Statuses = Statuses = {}));
exports.packageSchema = new mongoose_1.default.Schema({
    title: {
        type: String,
    },
    currency: {
        type: String,
        default: Currencies.rwf,
    },
    price: {
        type: Number,
    },
});
exports.ticketSchema = new mongoose_1.default.Schema({
    number: {
        type: Number,
        unique: true,
        dropDups: true,
        required: true,
    },
    qrCode: {
        type: String,
        required: true,
    },
    ticketPackage: {
        type: exports.packageSchema,
    },
    status: {
        type: String,
        default: Statuses.pending,
    },
    momoRef: {
        type: String,
    },
    momoPayload: {},
}, { timestamps: true });
exports.ticketModel = mongoose_1.default.model("tickets", exports.ticketSchema);
