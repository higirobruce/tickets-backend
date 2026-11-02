"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const cors_1 = __importDefault(require("cors"));
const helmet_1 = __importDefault(require("helmet"));
const express_rate_limit_1 = __importDefault(require("express-rate-limit"));
const mongoose_1 = __importDefault(require("mongoose"));
const routeUsers_1 = __importDefault(require("./routes/routeUsers"));
const routeEvents_1 = __importDefault(require("./routes/routeEvents"));
const routeMomo_1 = __importDefault(require("./routes/routeMomo"));
const routeTickets_1 = __importDefault(require("./routes/routeTickets"));
const routeAdmin_1 = __importDefault(require("./routes/routeAdmin"));
const app = (0, express_1.default)();
app.set("trust proxy", 1); // behind nginx; needed for correct client IPs in rate limiting
app.use((0, helmet_1.default)());
/** Comma-separated list of allowed browser origins. Unset means any origin (development). */
const allowedOrigins = (process.env.CORS_ORIGIN || "")
    .split(",")
    .map((o) => o.trim())
    .filter(Boolean);
app.use((0, cors_1.default)({
    origin: allowedOrigins.length ? allowedOrigins : true,
}));
app.use(express_1.default.json({ limit: "5mb" }));
app.use(express_1.default.urlencoded({ extended: true, limit: "5mb" }));
const isTest = process.env.NODE_ENV === "test" || Boolean(process.env.VITEST);
const limiter = (max, windowMinutes = 15) => (0, express_rate_limit_1.default)({
    windowMs: windowMinutes * 60 * 1000,
    max,
    standardHeaders: true,
    legacyHeaders: false,
    skip: () => isTest,
    message: { errorMessage: "Too many requests, please try again later" },
});
app.get("/", (req, res) => {
    res.send("Welcome to Tickets");
});
app.get("/health", (req, res) => {
    const dbUp = mongoose_1.default.connection.readyState === 1;
    res.status(dbUp ? 200 : 503).send({ status: dbUp ? "ok" : "degraded", db: dbUp ? "up" : "down" });
});
// Credential and payment endpoints get tight limits; everything else a generous one.
app.use(["/users/login", "/users/register", "/users"], limiter(20));
app.use("/momo", limiter(60));
app.use(limiter(600));
app.use("/users", routeUsers_1.default);
app.use("/events", routeEvents_1.default);
app.use("/momo", routeMomo_1.default);
app.use("/tickets", routeTickets_1.default);
app.use("/admin", routeAdmin_1.default);
app.use((req, res) => {
    res.status(404).send({ errorMessage: "Not found" });
});
app.use((err, req, res, next) => {
    console.error(err);
    if (res.headersSent)
        return next(err);
    res.status(500).send({ errorMessage: `${(err === null || err === void 0 ? void 0 : err.message) || err}` });
});
exports.default = app;
