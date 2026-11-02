import mongoose from "mongoose";
import { packageSchema } from "./shared";

export enum PaymentStatuses {
  pending = "PENDING",
  issuing = "ISSUING",
  successful = "SUCCESSFUL",
  failed = "FAILED",
  expired = "EXPIRED",
}

/**
 * One record per MoMo requestToPay. It is the source of truth for what was
 * bought (event, package, quantity) and whether tickets were already issued,
 * so polling the status more than once can never issue twice.
 */
export const paymentSchema = new mongoose.Schema(
  {
    refId: { type: String, required: true, unique: true },
    status: { type: String, default: PaymentStatuses.pending },
    payload: {},
    momoPayload: {},
    event: { type: mongoose.Types.ObjectId, ref: "events" },
    ticketPackage: { type: packageSchema },
    quantity: { type: Number, default: 1 },
    tickets: [{ type: mongoose.Types.ObjectId, ref: "tickets" }],
    issueError: { type: String },
    /** True while this payment holds capacity on its package. */
    reserved: { type: Boolean, default: false },
    buyer: { name: String, email: String },
  },
  { timestamps: true }
);

paymentSchema.index({ status: 1 });

export const paymentModel = mongoose.model("payments", paymentSchema);
