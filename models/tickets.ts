import mongoose from "mongoose";

export enum Currencies {
  rwf = "RWF",
  usd = "USD",
  eur = "EUR",
}

export enum Statuses {
  pending = "pending",
  ongoing = "ongoing",
  expired = "expired",
  cancelled = "cancelled",
  posponed = "postponed",
  upcoming = "upcoming",
  consumed = "consumed",
}

export const packageSchema = new mongoose.Schema({
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

export const ticketSchema = new mongoose.Schema(
  {
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
  },
  { timestamps: true }
);

export const ticketModel = mongoose.model("tickets", ticketSchema);
