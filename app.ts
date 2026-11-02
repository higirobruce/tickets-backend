import express, { Express, NextFunction, Request, Response } from "express";
import cors from "cors";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import mongoose from "mongoose";

import usersRoute from "./routes/routeUsers";
import eventsRoute from "./routes/routeEvents";
import momoRoute from "./routes/routeMomo";
import ticketsRoute from "./routes/routeTickets";
import adminRoute from "./routes/routeAdmin";

const app: Express = express();

app.set("trust proxy", 1); // behind nginx; needed for correct client IPs in rate limiting
app.use(helmet());

/** Comma-separated list of allowed browser origins. Unset means any origin (development). */
const allowedOrigins = (process.env.CORS_ORIGIN || "")
  .split(",")
  .map((o) => o.trim())
  .filter(Boolean);
app.use(
  cors({
    origin: allowedOrigins.length ? allowedOrigins : true,
  })
);

app.use(express.json({ limit: "5mb" }));
app.use(express.urlencoded({ extended: true, limit: "5mb" }));

const isTest = process.env.NODE_ENV === "test" || Boolean(process.env.VITEST);
const limiter = (max: number, windowMinutes = 15) =>
  rateLimit({
    windowMs: windowMinutes * 60 * 1000,
    max,
    standardHeaders: true,
    legacyHeaders: false,
    skip: () => isTest,
    message: { errorMessage: "Too many requests, please try again later" },
  });

app.get("/", (req: Request, res: Response) => {
  res.send("Welcome to Tickets");
});

app.get("/health", (req: Request, res: Response) => {
  const dbUp = mongoose.connection.readyState === 1;
  res.status(dbUp ? 200 : 503).send({ status: dbUp ? "ok" : "degraded", db: dbUp ? "up" : "down" });
});

// Credential and payment endpoints get tight limits; everything else a generous one.
app.use(["/users/login", "/users/register", "/users"], limiter(20));
app.use("/momo", limiter(60));
app.use(limiter(600));

app.use("/users", usersRoute);
app.use("/events", eventsRoute);
app.use("/momo", momoRoute);
app.use("/tickets", ticketsRoute);
app.use("/admin", adminRoute);

app.use((req: Request, res: Response) => {
  res.status(404).send({ errorMessage: "Not found" });
});

app.use((err: any, req: Request, res: Response, next: NextFunction) => {
  console.error(err);
  if (res.headersSent) return next(err);
  res.status(500).send({ errorMessage: `${err?.message || err}` });
});

export default app;
