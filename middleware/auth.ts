import { NextFunction, Request, Response } from "express";
import jwt from "jsonwebtoken";

export type Role = "admin" | "organiser" | "staff";
export const ROLES: Role[] = ["admin", "organiser", "staff"];

export interface AuthUser {
  _id: string;
  role: Role;
  /** Set for gate staff that belong to one organiser. */
  organiser?: string;
  email?: string;
  firstName?: string;
  lastName?: string;
}

/** Accounts that predate roles are the operator's, so they stay admin. */
export function roleOf(user: { role?: string | null }): Role {
  return (ROLES as string[]).includes(user?.role || "") ? (user.role as Role) : "admin";
}

declare global {
  namespace Express {
    interface Request {
      user?: AuthUser;
    }
  }
}

const DEV_SECRET = "dev-only-insecure-jwt-secret";
let warned = false;

export function jwtSecret(): string {
  const configured = process.env.JWT_SECRET || process.env.SALT;
  if (configured) return configured;
  if (process.env.NODE_ENV === "production") {
    throw new Error("JWT_SECRET must be set in production");
  }
  if (!warned) {
    console.warn("JWT_SECRET is not set; using an insecure development secret");
    warned = true;
  }
  return DEV_SECRET;
}

export function signToken(user: {
  _id: any;
  role?: string | null;
  organiser?: any;
  email?: string | null;
  firstName?: string | null;
  lastName?: string | null;
}) {
  return jwt.sign(
    {
      sub: String(user._id),
      role: roleOf(user),
      organiser: user.organiser ? String(user.organiser) : undefined,
      email: user.email ?? undefined,
      firstName: user.firstName ?? undefined,
      lastName: user.lastName ?? undefined,
    },
    jwtSecret(),
    { expiresIn: process.env.JWT_EXPIRES_IN || "12h" }
  );
}

/** Strip credentials before a user document leaves the API. */
export function publicUser(user: any) {
  const plain = typeof user?.toObject === "function" ? user.toObject() : { ...user };
  delete plain.password;
  delete plain.salt;
  plain.role = roleOf(plain);
  return plain;
}

export function ensureUserAuthorized(
  req: Request,
  res: Response,
  next: NextFunction
) {
  const header = req.headers.authorization || "";
  const [scheme, token] = header.split(" ");
  if (scheme !== "Bearer" || !token) {
    return res.status(401).send({ errorMessage: "Unauthorized" });
  }
  try {
    const payload = jwt.verify(token, jwtSecret()) as jwt.JwtPayload;
    req.user = {
      _id: String(payload.sub),
      role: roleOf({ role: typeof payload.role === "string" ? payload.role : null }),
      organiser: typeof payload.organiser === "string" ? payload.organiser : undefined,
      email: payload.email,
      firstName: payload.firstName,
      lastName: payload.lastName,
    };
    next();
  } catch (err) {
    res
      .status(401)
      .send({ errorMessage: "Please send a valid access token in the header" });
  }
}

/** Use after ensureUserAuthorized. */
export function requireRole(...roles: Role[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (req.user && roles.includes(req.user.role)) return next();
    res.status(403).send({ errorMessage: "You do not have access to this" });
  };
}
