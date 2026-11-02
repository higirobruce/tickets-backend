import { Router, Request, Response, NextFunction } from "express";
import {
  countUsers,
  getAllUsers,
  getUser,
  getUserById,
  saveUser,
} from "../controllers/controllerUsers";
import { generateSalt, hashPassword } from "../services/users";
import { userModel } from "../models/users";
import mongoose from "mongoose";
import crypto from "crypto";
import { validPassword } from "../services/users";
import { emailConfigured, sendPasswordResetEmail } from "../services/email";
import sendMessage from "../services/sms";
import { toInternational, webUrl } from "../services/tickets";

const RESET_TTL_MS = 60 * 60 * 1000;
const CODE_TTL_MS = 15 * 60 * 1000;
const sha = (value: string) => crypto.createHash("sha256").update(value).digest("hex");

function userPhone(user: any) {
  const p = user?.phoneNumber;
  return p?.phone ? toInternational(`${p.countryCode || "250"}${p.phone}`) : undefined;
}

async function applyNewPassword(user: any, password: string) {
  const salt = generateSalt();
  user.salt = salt;
  user.password = hashPassword(password, salt);
  user.reset = undefined;
  await user.save();
}
import {
  ensureUserAuthorized,
  publicUser,
  requireRole,
  signToken,
  ROLES,
} from "../middleware/auth";

let router = Router();

const DUPLICATE_KEY = 11000;

/** The very first account bootstraps the platform as admin; after that only an admin may add accounts. */
async function allowFirstUserOrAdmin(req: Request, res: Response, next: NextFunction) {
  if ((await countUsers()) === 0) return next();
  return ensureUserAuthorized(req, res, () => requireRole("admin")(req, res, next));
}

type AccountResult = { status: number; body: any };

async function createAccount(body: any, role: string, organiser?: string): Promise<AccountResult> {
  const { lastName, firstName, email, password, phoneNumber, organisation } = body || {};
  if (!email || !password || !firstName) {
    return { status: 400, body: { errorMessage: "firstName, email and password are required" } };
  }
  if (String(password).length < 6) {
    return { status: 400, body: { errorMessage: "Password must be at least 6 characters" } };
  }
  try {
    const salt = generateSalt();
    const user = await saveUser({
      lastName,
      firstName,
      email: String(email).trim().toLowerCase(),
      salt,
      password: hashPassword(password, salt),
      phoneNumber,
      organisation,
      role,
      organiser,
      status: "active",
    });
    return { status: 201, body: user };
  } catch (err: any) {
    if (err?.code === DUPLICATE_KEY) {
      return { status: 409, body: { errorMessage: "An account with this email already exists" } };
    }
    return { status: 400, body: { errorMessage: `${err}` } };
  }
}

router.get("/", ensureUserAuthorized, requireRole("admin"), async (req, res) => {
  res.send(await getAllUsers());
});

router.get("/me", ensureUserAuthorized, async (req, res) => {
  const user = await getUserById(req.user!._id);
  if (user) res.send(publicUser(user));
  else res.status(404).send({ errorMessage: "User not found" });
});

/** Gate staff that belong to the calling organiser (admins see every organiser-owned staff account). */
router.get("/staff", ensureUserAuthorized, requireRole("organiser", "admin"), async (req, res) => {
  const filter: Record<string, unknown> =
    req.user!.role === "admin" ? { role: "staff", organiser: { $ne: null } } : { role: "staff", organiser: req.user!._id };
  res.send(await userModel.find(filter).select("-password -salt").sort({ createdAt: 1 }));
});

router.post("/staff", ensureUserAuthorized, requireRole("organiser", "admin"), async (req, res) => {
  const organiser = req.user!.role === "admin" && req.body?.organiser ? String(req.body.organiser) : req.user!._id;
  const result = await createAccount(req.body, "staff", organiser);
  res.status(result.status).send(result.status === 201 ? publicUser(result.body) : result.body);
});

router.delete("/staff/:id", ensureUserAuthorized, requireRole("organiser", "admin"), async (req, res) => {
  const id = String(req.params.id);
  if (!mongoose.Types.ObjectId.isValid(id)) return res.status(404).send({ errorMessage: "Staff account not found" });
  const filter: any = { _id: id, role: "staff" };
  if (req.user!.role !== "admin") filter.organiser = req.user!._id;
  const removed = await userModel.findOneAndDelete(filter);
  if (!removed) return res.status(404).send({ errorMessage: "Staff account not found" });
  res.send({ removed: true });
});

router.get("/:id", ensureUserAuthorized, requireRole("admin"), async (req, res) => {
  const user = await getUserById(String(req.params.id));
  if (user) res.send(publicUser(user));
  else res.status(404).send({ errorMessage: "User not found" });
});

/**
 * Starts a password reset. Always answers 200 so the form cannot be used to probe for accounts.
 * Email gets a one-hour link; `via: "sms"` (or no email delivery) gets a 15-minute code on the account's phone.
 */
router.post("/forgot", async (req, res) => {
  const email = String(req.body?.email || "").trim().toLowerCase();
  const user = email ? await userModel.findOne({ email }) : null;
  if (!user) return res.send({ ok: true });
  const phone = userPhone(user);
  const preferSms = req.body?.via === "sms" || !emailConfigured();
  if (preferSms && phone) {
    const code = String(crypto.randomInt(0, 1000000)).padStart(6, "0");
    user.reset = { hash: sha(code), expires: new Date(Date.now() + CODE_TTL_MS) };
    await user.save();
    sendMessage(phone, `Your EvenTixr code is ${code}. It expires in 15 minutes.`, "EVENTIXR");
    return res.send({ ok: true, via: "sms" });
  }
  if (emailConfigured()) {
    const token = crypto.randomBytes(32).toString("hex");
    user.reset = { hash: sha(token), expires: new Date(Date.now() + RESET_TTL_MS) };
    await user.save();
    await sendPasswordResetEmail(user.email, `${webUrl()}/reset?token=${token}`);
    return res.send({ ok: true, via: "email" });
  }
  res.send({ ok: true });
});

/** Completes a reset with the emailed token, or with the account email plus the SMS code. */
router.post("/reset", async (req, res) => {
  const { token, email, code, password } = req.body || {};
  if (!password || String(password).length < 6) {
    return res.status(400).send({ errorMessage: "Password must be at least 6 characters" });
  }
  const secret = token || code;
  if (!secret) return res.status(400).send({ errorMessage: "Reset token or code is required" });
  const filter: any = { "reset.hash": sha(String(secret)), "reset.expires": { $gt: new Date() } };
  if (!token) filter.email = String(email || "").trim().toLowerCase();
  const user = await userModel.findOne(filter);
  if (!user) return res.status(400).send({ errorMessage: "This reset link or code is invalid or has expired" });
  await applyNewPassword(user, String(password));
  res.send({ token: signToken(user), user: publicUser(user) });
});

/** Change password while logged in. */
router.post("/password", ensureUserAuthorized, async (req, res) => {
  const { current, password } = req.body || {};
  if (!password || String(password).length < 6) {
    return res.status(400).send({ errorMessage: "New password must be at least 6 characters" });
  }
  const user = await userModel.findById(req.user!._id);
  if (!user || !validPassword(String(current || ""), user.password, user.salt)) {
    return res.status(401).send({ errorMessage: "Current password is wrong" });
  }
  await applyNewPassword(user, String(password));
  res.send({ ok: true });
});

router.post("/login", async (req, res) => {
  const { username, password } = req.body || {};
  const user = await getUser(String(username || "").trim().toLowerCase(), password);
  if (!user) {
    return res.status(401).send({ errorMessage: "Invalid username or password" });
  }
  res.send({ token: signToken(user), user: publicUser(user) });
});

/** Self-service onboarding for event owners. */
router.post("/register", async (req, res) => {
  const result = await createAccount(req.body, "organiser");
  if (result.status !== 201) return res.status(result.status).send(result.body);
  const user: any = result.body;
  res.status(201).send({ token: signToken(user), user: publicUser(user) });
});

router.post("/", allowFirstUserOrAdmin, async (req, res) => {
  const first = (await countUsers()) === 0;
  const requested = req.body?.role;
  const role = first ? "admin" : (ROLES as string[]).includes(requested) ? requested : "staff";
  const result = await createAccount(req.body, role);
  res.status(result.status).send(result.status === 201 ? publicUser(result.body) : result.body);
});

export default router;
