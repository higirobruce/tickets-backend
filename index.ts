import "dotenv/config";
import mongoose from "mongoose";
import app from "./app";
import { jwtSecret } from "./middleware/auth";
import { enabledProviders } from "./services/providers/registry";
import { ProviderConfigError } from "./services/providers/types";
import { smsRoutes } from "./services/sms/routes";

const PORT = process.env.PORT || 8081;
process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";

const mongoDB =
  (process.env.TICKETS_DB as string) || "mongodb://localhost:27017/tickets";

jwtSecret(); // fail fast in production when it is missing
if (process.env.PAYMENTS_MODE === "mock") {
  console.warn("PAYMENTS_MODE=mock: MTN MoMo is bypassed, every purchase is treated as paid. Testing only.");
}

// Fail fast on a bad payment/SMS config instead of at the first purchase. Tests build providers per file.
if (!process.env.VITEST) {
  try {
    enabledProviders();
    smsRoutes();
  } catch (err) {
    if (err instanceof ProviderConfigError) {
      console.error(`Configuration error: ${err.message}`);
      process.exit(1);
    }
    throw err;
  }
}

mongoose.connect(mongoDB);
const db = mongoose.connection;
db.on("error", console.error.bind(console, "MongoDB connection error:"));
db.once("open", () => console.log("connected to db"));

app.listen(PORT, () => {
  console.log(`⚡️[server]: Server is running at ${PORT}`);
});
