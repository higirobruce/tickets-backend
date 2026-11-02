"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.paymentModel = exports.paymentSchema = exports.PaymentStatuses = void 0;
const mongoose_1 = __importDefault(require("mongoose"));
const shared_1 = require("./shared");
var PaymentStatuses;
(function (PaymentStatuses) {
    PaymentStatuses["pending"] = "PENDING";
    PaymentStatuses["issuing"] = "ISSUING";
    PaymentStatuses["successful"] = "SUCCESSFUL";
    PaymentStatuses["failed"] = "FAILED";
    PaymentStatuses["expired"] = "EXPIRED";
})(PaymentStatuses || (exports.PaymentStatuses = PaymentStatuses = {}));
/**
 * One record per MoMo requestToPay. It is the source of truth for what was
 * bought (event, package, quantity) and whether tickets were already issued,
 * so polling the status more than once can never issue twice.
 */
exports.paymentSchema = new mongoose_1.default.Schema({
    refId: { type: String, required: true, unique: true },
    status: { type: String, default: PaymentStatuses.pending },
    payload: {},
    momoPayload: {},
    event: { type: mongoose_1.default.Types.ObjectId, ref: "events" },
    ticketPackage: { type: shared_1.packageSchema },
    quantity: { type: Number, default: 1 },
    tickets: [{ type: mongoose_1.default.Types.ObjectId, ref: "tickets" }],
    issueError: { type: String },
    /** True while this payment holds capacity on its package. */
    reserved: { type: Boolean, default: false },
    buyer: { name: String, email: String },
}, { timestamps: true });
exports.paymentSchema.index({ status: 1 });
exports.paymentModel = mongoose_1.default.model("payments", exports.paymentSchema);
