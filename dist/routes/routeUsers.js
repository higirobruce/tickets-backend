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
const express_1 = require("express");
const controllerUsers_1 = require("../controllers/controllerUsers");
const users_1 = require("../services/users");
const users_2 = require("../models/users");
const mongoose_1 = __importDefault(require("mongoose"));
const crypto_1 = __importDefault(require("crypto"));
const users_3 = require("../services/users");
const email_1 = require("../services/email");
const sms_1 = __importDefault(require("../services/sms"));
const tickets_1 = require("../services/tickets");
const RESET_TTL_MS = 60 * 60 * 1000;
const CODE_TTL_MS = 15 * 60 * 1000;
const sha = (value) => crypto_1.default.createHash("sha256").update(value).digest("hex");
function userPhone(user) {
    const p = user === null || user === void 0 ? void 0 : user.phoneNumber;
    return (p === null || p === void 0 ? void 0 : p.phone) ? (0, tickets_1.toInternational)(`${p.countryCode || "250"}${p.phone}`) : undefined;
}
function applyNewPassword(user, password) {
    return __awaiter(this, void 0, void 0, function* () {
        const salt = (0, users_1.generateSalt)();
        user.salt = salt;
        user.password = (0, users_1.hashPassword)(password, salt);
        user.reset = undefined;
        yield user.save();
    });
}
const auth_1 = require("../middleware/auth");
let router = (0, express_1.Router)();
const DUPLICATE_KEY = 11000;
/** The very first account bootstraps the platform as admin; after that only an admin may add accounts. */
function allowFirstUserOrAdmin(req, res, next) {
    return __awaiter(this, void 0, void 0, function* () {
        if ((yield (0, controllerUsers_1.countUsers)()) === 0)
            return next();
        return (0, auth_1.ensureUserAuthorized)(req, res, () => (0, auth_1.requireRole)("admin")(req, res, next));
    });
}
function createAccount(body, role, organiser) {
    return __awaiter(this, void 0, void 0, function* () {
        const { lastName, firstName, email, password, phoneNumber, organisation } = body || {};
        if (!email || !password || !firstName) {
            return { status: 400, body: { errorMessage: "firstName, email and password are required" } };
        }
        if (String(password).length < 6) {
            return { status: 400, body: { errorMessage: "Password must be at least 6 characters" } };
        }
        try {
            const salt = (0, users_1.generateSalt)();
            const user = yield (0, controllerUsers_1.saveUser)({
                lastName,
                firstName,
                email: String(email).trim().toLowerCase(),
                salt,
                password: (0, users_1.hashPassword)(password, salt),
                phoneNumber,
                organisation,
                role,
                organiser,
                status: "active",
            });
            return { status: 201, body: user };
        }
        catch (err) {
            if ((err === null || err === void 0 ? void 0 : err.code) === DUPLICATE_KEY) {
                return { status: 409, body: { errorMessage: "An account with this email already exists" } };
            }
            return { status: 400, body: { errorMessage: `${err}` } };
        }
    });
}
router.get("/", auth_1.ensureUserAuthorized, (0, auth_1.requireRole)("admin"), (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    res.send(yield (0, controllerUsers_1.getAllUsers)());
}));
router.get("/me", auth_1.ensureUserAuthorized, (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const user = yield (0, controllerUsers_1.getUserById)(req.user._id);
    if (user)
        res.send((0, auth_1.publicUser)(user));
    else
        res.status(404).send({ errorMessage: "User not found" });
}));
/** Gate staff that belong to the calling organiser (admins see every organiser-owned staff account). */
router.get("/staff", auth_1.ensureUserAuthorized, (0, auth_1.requireRole)("organiser", "admin"), (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const filter = req.user.role === "admin" ? { role: "staff", organiser: { $ne: null } } : { role: "staff", organiser: req.user._id };
    res.send(yield users_2.userModel.find(filter).select("-password -salt").sort({ createdAt: 1 }));
}));
router.post("/staff", auth_1.ensureUserAuthorized, (0, auth_1.requireRole)("organiser", "admin"), (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a;
    const organiser = req.user.role === "admin" && ((_a = req.body) === null || _a === void 0 ? void 0 : _a.organiser) ? String(req.body.organiser) : req.user._id;
    const result = yield createAccount(req.body, "staff", organiser);
    res.status(result.status).send(result.status === 201 ? (0, auth_1.publicUser)(result.body) : result.body);
}));
router.delete("/staff/:id", auth_1.ensureUserAuthorized, (0, auth_1.requireRole)("organiser", "admin"), (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const id = String(req.params.id);
    if (!mongoose_1.default.Types.ObjectId.isValid(id))
        return res.status(404).send({ errorMessage: "Staff account not found" });
    const filter = { _id: id, role: "staff" };
    if (req.user.role !== "admin")
        filter.organiser = req.user._id;
    const removed = yield users_2.userModel.findOneAndDelete(filter);
    if (!removed)
        return res.status(404).send({ errorMessage: "Staff account not found" });
    res.send({ removed: true });
}));
router.get("/:id", auth_1.ensureUserAuthorized, (0, auth_1.requireRole)("admin"), (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const user = yield (0, controllerUsers_1.getUserById)(String(req.params.id));
    if (user)
        res.send((0, auth_1.publicUser)(user));
    else
        res.status(404).send({ errorMessage: "User not found" });
}));
/**
 * Starts a password reset. Always answers 200 so the form cannot be used to probe for accounts.
 * Email gets a one-hour link; `via: "sms"` (or no email delivery) gets a 15-minute code on the account's phone.
 */
router.post("/forgot", (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a, _b;
    const email = String(((_a = req.body) === null || _a === void 0 ? void 0 : _a.email) || "").trim().toLowerCase();
    const user = email ? yield users_2.userModel.findOne({ email }) : null;
    if (!user)
        return res.send({ ok: true });
    const phone = userPhone(user);
    const preferSms = ((_b = req.body) === null || _b === void 0 ? void 0 : _b.via) === "sms" || !(0, email_1.emailConfigured)();
    if (preferSms && phone) {
        const code = String(crypto_1.default.randomInt(0, 1000000)).padStart(6, "0");
        user.reset = { hash: sha(code), expires: new Date(Date.now() + CODE_TTL_MS) };
        yield user.save();
        (0, sms_1.default)(phone, `Your EvenTixr code is ${code}. It expires in 15 minutes.`, "EVENTIXR");
        return res.send({ ok: true, via: "sms" });
    }
    if ((0, email_1.emailConfigured)()) {
        const token = crypto_1.default.randomBytes(32).toString("hex");
        user.reset = { hash: sha(token), expires: new Date(Date.now() + RESET_TTL_MS) };
        yield user.save();
        yield (0, email_1.sendPasswordResetEmail)(user.email, `${(0, tickets_1.webUrl)()}/reset?token=${token}`);
        return res.send({ ok: true, via: "email" });
    }
    res.send({ ok: true });
}));
/** Completes a reset with the emailed token, or with the account email plus the SMS code. */
router.post("/reset", (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const { token, email, code, password } = req.body || {};
    if (!password || String(password).length < 6) {
        return res.status(400).send({ errorMessage: "Password must be at least 6 characters" });
    }
    const secret = token || code;
    if (!secret)
        return res.status(400).send({ errorMessage: "Reset token or code is required" });
    const filter = { "reset.hash": sha(String(secret)), "reset.expires": { $gt: new Date() } };
    if (!token)
        filter.email = String(email || "").trim().toLowerCase();
    const user = yield users_2.userModel.findOne(filter);
    if (!user)
        return res.status(400).send({ errorMessage: "This reset link or code is invalid or has expired" });
    yield applyNewPassword(user, String(password));
    res.send({ token: (0, auth_1.signToken)(user), user: (0, auth_1.publicUser)(user) });
}));
/** Change password while logged in. */
router.post("/password", auth_1.ensureUserAuthorized, (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const { current, password } = req.body || {};
    if (!password || String(password).length < 6) {
        return res.status(400).send({ errorMessage: "New password must be at least 6 characters" });
    }
    const user = yield users_2.userModel.findById(req.user._id);
    if (!user || !(0, users_3.validPassword)(String(current || ""), user.password, user.salt)) {
        return res.status(401).send({ errorMessage: "Current password is wrong" });
    }
    yield applyNewPassword(user, String(password));
    res.send({ ok: true });
}));
router.post("/login", (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const { username, password } = req.body || {};
    const user = yield (0, controllerUsers_1.getUser)(String(username || "").trim().toLowerCase(), password);
    if (!user) {
        return res.status(401).send({ errorMessage: "Invalid username or password" });
    }
    res.send({ token: (0, auth_1.signToken)(user), user: (0, auth_1.publicUser)(user) });
}));
/** Self-service onboarding for event owners. */
router.post("/register", (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const result = yield createAccount(req.body, "organiser");
    if (result.status !== 201)
        return res.status(result.status).send(result.body);
    const user = result.body;
    res.status(201).send({ token: (0, auth_1.signToken)(user), user: (0, auth_1.publicUser)(user) });
}));
router.post("/", allowFirstUserOrAdmin, (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a;
    const first = (yield (0, controllerUsers_1.countUsers)()) === 0;
    const requested = (_a = req.body) === null || _a === void 0 ? void 0 : _a.role;
    const role = first ? "admin" : auth_1.ROLES.includes(requested) ? requested : "staff";
    const result = yield createAccount(req.body, role);
    res.status(result.status).send(result.status === 201 ? (0, auth_1.publicUser)(result.body) : result.body);
}));
exports.default = router;
