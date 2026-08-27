import { MongoMemoryServer } from "mongodb-memory-server";
import { afterAll, beforeAll } from "vitest";

import { createEngagementIndexes } from "@/lib/engagement";
import { closeClient } from "@/lib/mongodb";
import { createShotefReviewIndexes } from "@/lib/shotef-reviews";

/**
 * Spins up a throwaway in-memory MongoDB for the server suite. `getClient()`
 * reads MONGODB_URI lazily on the first query, so setting it here — after
 * imports have already run — is enough.
 */
let server: MongoMemoryServer;

beforeAll(async () => {
  server = await MongoMemoryServer.create();
  process.env.MONGODB_URI = server.getUri();
  process.env.MONGODB_DB = "zitutim_test";
  await createEngagementIndexes();
  await createShotefReviewIndexes();
});

afterAll(async () => {
  // Close the pool so the worker can exit instead of hanging on open sockets.
  await closeClient();
  await server?.stop();
});
