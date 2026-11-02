"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.seesEveryEvent = seesEveryEvent;
exports.organiserIdOf = organiserIdOf;
exports.canManageEvent = canManageEvent;
exports.ownedEventIds = ownedEventIds;
exports.ticketScope = ticketScope;
const mongoose_1 = __importDefault(require("mongoose"));
const events_1 = require("../models/events");
/** Admins and platform-wide gate staff work across every event; organisers and their staff only their own. */
function seesEveryEvent(user) {
    return user.role === "admin" || (user.role === "staff" && !user.organiser);
}
/** The organiser whose events this user manages or scans. */
function organiserIdOf(user) {
    return user.role === "staff" ? user.organiser : user._id;
}
function canManageEvent(user, event) {
    if (!event)
        return false;
    if (user.role === "admin")
        return true;
    return user.role === "organiser" && String(event.owner || "") === user._id;
}
function ownedEventIds(user) {
    return __awaiter(this, void 0, void 0, function* () {
        const owner = organiserIdOf(user);
        if (!owner)
            return [];
        const events = yield events_1.eventModel.find({ owner }).select("_id");
        return events.map((e) => e._id);
    });
}
/**
 * Narrows a ticket query to what the user may see.
 * Returns null when the requested event is not theirs.
 */
function ticketScope(user, eventId) {
    return __awaiter(this, void 0, void 0, function* () {
        if (eventId && !mongoose_1.default.Types.ObjectId.isValid(eventId))
            return null;
        if (seesEveryEvent(user)) {
            return eventId ? { event: new mongoose_1.default.Types.ObjectId(eventId) } : {};
        }
        const owned = yield ownedEventIds(user);
        if (eventId) {
            return owned.some((id) => String(id) === eventId)
                ? { event: new mongoose_1.default.Types.ObjectId(eventId) }
                : null;
        }
        return { event: { $in: owned } };
    });
}
