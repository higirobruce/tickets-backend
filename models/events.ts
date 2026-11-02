import mongoose from "mongoose";
import { Currencies, Statuses, packageSchema } from "./shared";

export { Currencies, Statuses, packageSchema };

export const eventSchema = new mongoose.Schema({
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
  packages: [{ type: packageSchema }],
  status: {
    type: String,
    default: Statuses.pending,
  },
  owner: {
    type: mongoose.Types.ObjectId,
    ref: "users",
  },
  /** Unpublished events are drafts: visible to their owner only. */
  published: { type: Boolean, default: true },
}, { timestamps: true });

eventSchema.index({ owner: 1 });
eventSchema.index({ date: 1 });

export const eventModel = mongoose.model("events", eventSchema);
