import "dotenv/config";
import mongoose from "mongoose";
import app from "./app";
import { jwtSecret } from "./middleware/auth";

const PORT = process.env.PORT || 8081;
process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";

const mongoDB =
  (process.env.TICKETS_DB as string) || "mongodb://localhost:27017/tickets";

jwtSecret(); // fail fast in production when it is missing
if (process.env.PAYMENTS_MODE === "mock") {
  console.warn("PAYMENTS_MODE=mock: MTN MoMo is bypassed, every purchase is treated as paid. Testing only.");
}

mongoose.connect(mongoDB);
const db = mongoose.connection;
db.on("error", console.error.bind(console, "MongoDB connection error:"));
db.once("open", () => console.log("connected to db"));

app.listen(PORT, () => {
  console.log(`⚡️[server]: Server is running at ${PORT}`);
});
