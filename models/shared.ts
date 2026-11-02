import mongoose from "mongoose";

export enum Currencies {
  rwf = "RWF",
  usd = "USD",
  eur = "EUR",
}

/** Lifecycle values shared by events and tickets. */
export enum Statuses {
  pending = "pending",
  ongoing = "ongoing",
  expired = "expired",
  cancelled = "cancelled",
  postponed = "postponed",
  upcoming = "upcoming",
  consumed = "consumed",
  sold = "sold",
}

export const packageSchema = new mongoose.Schema({
  title: { type: String },
  currency: { type: String, default: Currencies.rwf },
  price: { type: Number },
  soldOut: { type: Boolean, default: false },
  /** Maximum tickets for this package; unset means unlimited. */
  capacity: { type: Number },
  /** Tickets sold or reserved against the capacity. Maintained atomically by services/payments.ts. */
  sold: { type: Number, default: 0 },
});
