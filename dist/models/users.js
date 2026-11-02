"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.userModel = exports.userSchema = exports.phoneNumberSchema = void 0;
const mongoose_1 = __importDefault(require("mongoose"));
exports.phoneNumberSchema = new mongoose_1.default.Schema({
    countryCode: String,
    phone: String,
});
exports.userSchema = new mongoose_1.default.Schema({
    lastName: {
        type: String,
    },
    firstName: {
        type: String,
        required: true,
    },
    email: {
        type: String,
        required: true,
        unique: true,
    },
    otp: {
        type: String,
    },
    password: String,
    // Per-user salt for PBKDF2. Users created before this field existed have
    // none and are verified against the legacy shared salt.
    salt: String,
    profilePictureUrl: String,
    status: String,
    // admin: platform operator. organiser: event owner. staff: gate.
    // Accounts created before roles existed have none and are treated as admin.
    role: { type: String, enum: ["admin", "organiser", "staff"] },
    organisation: String,
    /** For gate staff created by an organiser: the organiser whose events they may scan. */
    organiser: { type: mongoose_1.default.Types.ObjectId, ref: "users" },
    /** Hashed one-time password-reset token or SMS code, with its expiry. */
    reset: { hash: String, expires: Date },
    phoneNumber: {
        type: exports.phoneNumberSchema,
    },
}, { timestamps: true, strict: true });
exports.userModel = mongoose_1.default.model("users", exports.userSchema);
