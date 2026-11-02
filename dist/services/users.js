"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.validPassword = exports.hashPassword = exports.generateSalt = exports.generatePassword = void 0;
const crypto_1 = __importDefault(require("crypto"));
// Salt shared by every account created before per-user salts existed.
// Changing it would lock those accounts out, so it only moves to an env var.
const LEGACY_SALT = process.env.PASSWORD_SALT || "762f021e88bdfdc80f8e174edbdfaf65";
const generatePassword = (length = 20, wishlist = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz~!@-#$") => Array.from(crypto_1.default.randomFillSync(new Uint32Array(length)))
    .map((x) => wishlist[x % wishlist.length])
    .join("");
exports.generatePassword = generatePassword;
const generateSalt = () => crypto_1.default.randomBytes(16).toString("hex");
exports.generateSalt = generateSalt;
const hashPassword = (password, salt = LEGACY_SALT) => crypto_1.default.pbkdf2Sync(password, salt, 1000, 64, "sha512").toString("hex");
exports.hashPassword = hashPassword;
const validPassword = (password, savedPassword, salt) => {
    if (!password || !savedPassword)
        return false;
    const hash = (0, exports.hashPassword)(password, salt || LEGACY_SALT);
    const a = Buffer.from(hash);
    const b = Buffer.from(savedPassword);
    return a.length === b.length && crypto_1.default.timingSafeEqual(a, b);
};
exports.validPassword = validPassword;
