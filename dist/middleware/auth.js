"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.ROLES = void 0;
exports.roleOf = roleOf;
exports.jwtSecret = jwtSecret;
exports.signToken = signToken;
exports.publicUser = publicUser;
exports.ensureUserAuthorized = ensureUserAuthorized;
exports.requireRole = requireRole;
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
exports.ROLES = ["admin", "organiser", "staff"];
/** Accounts that predate roles are the operator's, so they stay admin. */
function roleOf(user) {
    return exports.ROLES.includes((user === null || user === void 0 ? void 0 : user.role) || "") ? user.role : "admin";
}
const DEV_SECRET = "dev-only-insecure-jwt-secret";
let warned = false;
function jwtSecret() {
    const configured = process.env.JWT_SECRET || process.env.SALT;
    if (configured)
        return configured;
    if (process.env.NODE_ENV === "production") {
        throw new Error("JWT_SECRET must be set in production");
    }
    if (!warned) {
        console.warn("JWT_SECRET is not set; using an insecure development secret");
        warned = true;
    }
    return DEV_SECRET;
}
function signToken(user) {
    var _a, _b, _c;
    return jsonwebtoken_1.default.sign({
        sub: String(user._id),
        role: roleOf(user),
        organiser: user.organiser ? String(user.organiser) : undefined,
        email: (_a = user.email) !== null && _a !== void 0 ? _a : undefined,
        firstName: (_b = user.firstName) !== null && _b !== void 0 ? _b : undefined,
        lastName: (_c = user.lastName) !== null && _c !== void 0 ? _c : undefined,
    }, jwtSecret(), { expiresIn: process.env.JWT_EXPIRES_IN || "12h" });
}
/** Strip credentials before a user document leaves the API. */
function publicUser(user) {
    const plain = typeof (user === null || user === void 0 ? void 0 : user.toObject) === "function" ? user.toObject() : Object.assign({}, user);
    delete plain.password;
    delete plain.salt;
    plain.role = roleOf(plain);
    return plain;
}
function ensureUserAuthorized(req, res, next) {
    const header = req.headers.authorization || "";
    const [scheme, token] = header.split(" ");
    if (scheme !== "Bearer" || !token) {
        return res.status(401).send({ errorMessage: "Unauthorized" });
    }
    try {
        const payload = jsonwebtoken_1.default.verify(token, jwtSecret());
        req.user = {
            _id: String(payload.sub),
            role: roleOf({ role: typeof payload.role === "string" ? payload.role : null }),
            organiser: typeof payload.organiser === "string" ? payload.organiser : undefined,
            email: payload.email,
            firstName: payload.firstName,
            lastName: payload.lastName,
        };
        next();
    }
    catch (err) {
        res
            .status(401)
            .send({ errorMessage: "Please send a valid access token in the header" });
    }
}
/** Use after ensureUserAuthorized. */
function requireRole(...roles) {
    return (req, res, next) => {
        if (req.user && roles.includes(req.user.role))
            return next();
        res.status(403).send({ errorMessage: "You do not have access to this" });
    };
}
