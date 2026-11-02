import mongoose from "mongoose";
import { AuthUser } from "../middleware/auth";
import { eventModel } from "../models/events";

/** Admins and platform-wide gate staff work across every event; organisers and their staff only their own. */
export function seesEveryEvent(user: AuthUser) {
  return user.role === "admin" || (user.role === "staff" && !user.organiser);
}

/** The organiser whose events this user manages or scans. */
export function organiserIdOf(user: AuthUser) {
  return user.role === "staff" ? user.organiser : user._id;
}

export function canManageEvent(user: AuthUser, event: { owner?: any } | null) {
  if (!event) return false;
  if (user.role === "admin") return true;
  return user.role === "organiser" && String(event.owner || "") === user._id;
}

export async function ownedEventIds(user: AuthUser) {
  const owner = organiserIdOf(user);
  if (!owner) return [];
  const events = await eventModel.find({ owner }).select("_id");
  return events.map((e) => e._id);
}

/**
 * Narrows a ticket query to what the user may see.
 * Returns null when the requested event is not theirs.
 */
export async function ticketScope(user: AuthUser, eventId?: string) {
  if (eventId && !mongoose.Types.ObjectId.isValid(eventId)) return null;
  if (seesEveryEvent(user)) {
    return eventId ? { event: new mongoose.Types.ObjectId(eventId) } : {};
  }
  const owned = await ownedEventIds(user);
  if (eventId) {
    return owned.some((id) => String(id) === eventId)
      ? { event: new mongoose.Types.ObjectId(eventId) }
      : null;
  }
  return { event: { $in: owned } };
}
