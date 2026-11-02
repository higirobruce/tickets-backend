"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.ticketModel = exports.ticketSchema = exports.packageSchema = exports.Statuses = exports.Currencies = void 0;
const mongoose_1 = __importDefault(require("mongoose"));
const shared_1 = require("./shared");
Object.defineProperty(exports, "Currencies", { enumerable: true, get: function () { return shared_1.Currencies; } });
Object.defineProperty(exports, "Statuses", { enumerable: true, get: function () { return shared_1.Statuses; } });
Object.defineProperty(exports, "packageSchema", { enumerable: true, get: function () { return shared_1.packageSchema; } });
exports.ticketSchema = new mongoose_1.default.Schema({
    number: {
        type: Number,
        unique: true,
        required: true,
    },
    qrCode: {
        type: String,
        required: true,
    },
    ticketPackage: {
        type: shared_1.packageSchema,
    },
    status: {
        type: String,
        default: shared_1.Statuses.pending,
    },
    momoRef: {
        type: String,
    },
    event: {
        type: mongoose_1.default.Types.ObjectId,
        ref: "events",
    },
    consumedBy: {
        type: mongoose_1.default.Types.ObjectId,
        ref: "users",
    },
    momoPayload: {},
    buyer: { name: String, email: String },
    /** Issued by the organiser for free (press, guests); never counted as revenue. */
    complimentary: { type: Boolean, default: false },
    note: String,
}, { timestamps: true });
exports.ticketSchema.index({ event: 1, createdAt: -1 });
exports.ticketModel = mongoose_1.default.model("tickets", exports.ticketSchema);
