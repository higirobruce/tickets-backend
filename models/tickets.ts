import mongoose from "mongoose";
import { Currencies, Statuses, packageSchema } from "./shared";

export { Currencies, Statuses, packageSchema };

export const ticketSchema = new mongoose.Schema(
  {
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
      type: packageSchema,
    },
    status: {
      type: String,
      default: Statuses.pending,
    },
    momoRef: {
      type: String,
    },
    event: {
      type: mongoose.Types.ObjectId,
      ref: "events",
    },
    consumedBy:{
      type: mongoose.Types.ObjectId,
      ref: "users",
    },
    momoPayload: {},
    /** Provider-neutral record of how the ticket was paid for. */
    payment: { provider: String, ref: String, amount: Number, currency: String, phone: String },
    buyer: { name: String, email: String },
    /** Issued by the organiser for free (press, guests); never counted as revenue. */
    complimentary: { type: Boolean, default: false },
    note: String,
    /** "sent" | "unrouted" (no SMS route for the phone's country) | "none" (no phone). */
    smsStatus: String,
  },
  { timestamps: true }
);

ticketSchema.index({ event: 1, createdAt: -1 });

export const ticketModel = mongoose.model("tickets", ticketSchema);
