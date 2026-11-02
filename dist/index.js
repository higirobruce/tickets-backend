"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
require("dotenv/config");
const mongoose_1 = __importDefault(require("mongoose"));
const app_1 = __importDefault(require("./app"));
const auth_1 = require("./middleware/auth");
const PORT = process.env.PORT || 8081;
process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";
const mongoDB = process.env.TICKETS_DB || "mongodb://localhost:27017/tickets";
(0, auth_1.jwtSecret)(); // fail fast in production when it is missing
if (process.env.PAYMENTS_MODE === "mock") {
    console.warn("PAYMENTS_MODE=mock: MTN MoMo is bypassed, every purchase is treated as paid. Testing only.");
}
mongoose_1.default.connect(mongoDB);
const db = mongoose_1.default.connection;
db.on("error", console.error.bind(console, "MongoDB connection error:"));
db.once("open", () => console.log("connected to db"));
app_1.default.listen(PORT, () => {
    console.log(`⚡️[server]: Server is running at ${PORT}`);
});
