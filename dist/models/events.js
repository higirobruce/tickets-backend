"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.eventModel = exports.eventSchema = exports.packageSchema = exports.Statuses = exports.Currencies = void 0;
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
    Statuses["sold"] = "sold";
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
        type: Number
    }
});
exports.eventSchema = new mongoose_1.default.Schema({
    imageUrl: {
        type: String,
        required: true,
    },
    title: {
        type: String,
        required: true,
    },
    date: {
        type: Date,
        required: true,
    },
    artist: {
        type: String,
        required: true,
    },
    location: {
        type: String,
        required: true,
    },
    packages: [{ type: exports.packageSchema }],
    status: {
        type: String,
        default: Statuses.pending,
    },
});
exports.eventModel = mongoose_1.default.model("events", exports.eventSchema);
// {
//     _id: "1",
//     imageUrl:
//       "https://rgtickets.com/wp-content/uploads/2022/08/WhatsApp-Image-2022-08-25-at-2.05.58-PM-1.jpeg",
//     title: "Igicaniro Concert Series with Luc Buntu",
//     date: "01st June 2021",
//     time: "18h",
//     artist: "Luc Buntu",
//     location: "The Prayer House",
//     packages: [
//       {
//         title: "Regular",
//         price: 5000,
//         currency: "RWF",
//       },
//       {
//         title: "VIP",
//         price: 10000,
//         currency: "RWF",
//       },
//       {
//         title: "VVIP",
//         price: 30000,
//         currency: "RWF",
//       },
//     ],
//     status: 'pending'
//   },
