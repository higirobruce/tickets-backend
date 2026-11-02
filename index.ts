import "dotenv/config";
import mongoose from "mongoose";
import app from "./app";
import { jwtSecret } from "./middleware/auth";
import { enabledProviderIds, enabledProviders } from "./services/providers/registry";
import { ProviderConfigError } from "./services/providers/types";
import { smsRoutes } from "./services/sms/routes";

const PORT = process.env.PORT || 8081;
process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";

const mongoDB =
  (process.env.TICKETS_DB as string) || "mongodb://localhost:27017/tickets";

jwtSecret(); // fail fast in production when it is missing
// enabledProviderIds covers both PAYMENTS_MODE=mock and PAYMENT_PROVIDERS containing mock.
try {
  if (enabledProviderIds().includes("mock")) {
    console.warn("The mock payment provider is enabled: every purchase with it is treated as paid. Testing only.");
  }
} catch {
  // A bad PAYMENT_PROVIDERS is reported by the config check below.
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
