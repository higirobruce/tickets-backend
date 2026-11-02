import mongoose from "mongoose";

export const phoneNumberSchema = new mongoose.Schema({
  countryCode: String,
  phone: String,
});


export const userSchema = new mongoose.Schema(
  {
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
    organiser: { type: mongoose.Types.ObjectId, ref: "users" },
    /** Hashed one-time password-reset token or SMS code, with its expiry. */
    reset: { hash: String, expires: Date },
    phoneNumber: {
      type: phoneNumberSchema,
    },
  },
  { timestamps: true, strict: true }
);

export const userModel = mongoose.model("users", userSchema);
