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
 * One record per payment request, whatever the provider. It is the source of
 * truth for what was bought (event, package, quantity) and whether tickets were
 * already issued, so polling the status more than once can never issue twice.
 * `payload` is what we sent; `momoPayload` holds the provider's raw response.
 */
export const paymentSchema = new mongoose.Schema(
  {
    refId: { type: String, required: true, unique: true },
    /** Records created before providers existed are all MoMo, hence the default. */
    provider: { type: String, default: "momo" },
    /** The provider's own transaction id, known once it reports the payment. */
    providerRef: String,
    amount: Number,
    currency: String,
    phone: String,
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
    /** When the stale sweep last asked the provider about this payment; throttles re-verification. */
    lastVerifiedAt: Date,
    /** Admin who expired a stuck pending payment by hand, and when. */
    releasedBy: { type: mongoose.Types.ObjectId, ref: "users" },
    releasedAt: Date,
  },
  { timestamps: true }
);

paymentSchema.index({ status: 1 });
paymentSchema.index({ provider: 1, providerRef: 1 });

export const paymentModel = mongoose.model("payments", paymentSchema);
