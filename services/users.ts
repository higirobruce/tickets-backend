import crypto from "crypto";

// Salt shared by every account created before per-user salts existed.
// Changing it would lock those accounts out, so it only moves to an env var.
const LEGACY_SALT =
  process.env.PASSWORD_SALT || "762f021e88bdfdc80f8e174edbdfaf65";

export const generatePassword = (
  length = 20,
  wishlist = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz~!@-#$"
) =>
  Array.from(crypto.randomFillSync(new Uint32Array(length)))
    .map((x) => wishlist[x % wishlist.length])
    .join("");

export const generateSalt = () => crypto.randomBytes(16).toString("hex");

export const hashPassword = (password: string, salt: string = LEGACY_SALT) =>
  crypto.pbkdf2Sync(password, salt, 1000, 64, "sha512").toString("hex");

export const validPassword = (
  password: string,
  savedPassword: string | undefined | null,
  salt?: string | null
) => {
  if (!password || !savedPassword) return false;
  const hash = hashPassword(password, salt || LEGACY_SALT);
  const a = Buffer.from(hash);
  const b = Buffer.from(savedPassword);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
};
