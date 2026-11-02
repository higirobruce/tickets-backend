"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.eventModel = exports.eventSchema = exports.packageSchema = exports.Statuses = exports.Currencies = void 0;
const mongoose_1 = __importDefault(require("mongoose"));
const shared_1 = require("./shared");
Object.defineProperty(exports, "Currencies", { enumerable: true, get: function () { return shared_1.Currencies; } });
Object.defineProperty(exports, "Statuses", { enumerable: true, get: function () { return shared_1.Statuses; } });
Object.defineProperty(exports, "packageSchema", { enumerable: true, get: function () { return shared_1.packageSchema; } });
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
    description: {
        type: String,
    },
    location: {
        type: String,
        required: true,
    },
    packages: [{ type: shared_1.packageSchema }],
    status: {
        type: String,
        default: shared_1.Statuses.pending,
    },
    owner: {
        type: mongoose_1.default.Types.ObjectId,
        ref: "users",
    },
    /** Unpublished events are drafts: visible to their owner only. */
    published: { type: Boolean, default: true },
}, { timestamps: true });
exports.eventSchema.index({ owner: 1 });
exports.eventSchema.index({ date: 1 });
exports.eventModel = mongoose_1.default.model("events", exports.eventSchema);
