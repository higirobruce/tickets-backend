import mongoose from "mongoose";
import { beforeAll, afterAll, beforeEach, vi } from "vitest";

/** Every test gets a stubbed global fetch so nothing reaches MTN. Payment tests script its responses. */
export const fetchMock = vi.fn();
vi.stubGlobal("fetch", fetchMock);

process.env.JWT_SECRET = "test-secret";
process.env.TICKETS_WEB_URL = "http://web.test";
process.env.TICKETS_BCKEND_URL = "http://api.test";
process.env.MOMO_BASE_URL = "http://momo.test";
process.env.MOMO_SUBSCRIPTION_KEY = "test-sub-key";
process.env.MOMO_ENVIRONMENT = "sandbox";
process.env.MOMO_API_USER = "test-api-user";
process.env.MOMO_BASIC_AUTH = "dGVzdDp0ZXN0";

const TEST_DB =
  process.env.TICKETS_TEST_DB || "mongodb://localhost:27017/tickets_test";

beforeAll(async () => {
  await mongoose.connect(TEST_DB);
  // Unique and lookup indexes build asynchronously; wait so the first test cannot race them.
  await import("../models/users");
  await import("../models/events");
  await import("../models/tickets");
  await import("../models/payments");
  await Promise.all(Object.values(mongoose.models).map((m) => m.init()));
});

beforeEach(async () => {
  fetchMock.mockReset();
  const collections = await mongoose.connection.db!.collections();
  await Promise.all(collections.map((c) => c.deleteMany({})));
});

afterAll(async () => {
  await mongoose.connection.db!.dropDatabase();
  await mongoose.disconnect();
});
