import { MongoClient, type Db } from "mongodb";

// In dev, Next.js hot-reloads modules on every edit. Caching the client on
// globalThis keeps us from opening a new connection pool each time.
declare global {
  var _mongoClientPromise: Promise<MongoClient> | undefined;
}

/**
 * Connect lazily rather than at import time: the env var is read when the
 * first query runs, so importing this module is always safe (and tests can
 * point MONGODB_URI at a throwaway server before touching the database).
 */
export function getClient(): Promise<MongoClient> {
  if (global._mongoClientPromise) return global._mongoClientPromise;

  const uri = process.env.MONGODB_URI;
  if (!uri) {
    throw new Error(
      "MONGODB_URI is not set. Copy .env.example to .env.local and fill it in.",
    );
  }

  const clientPromise = new MongoClient(uri).connect();
  global._mongoClientPromise = clientPromise;
  return clientPromise;
}

export async function getDb(): Promise<Db> {
  const client = await getClient();
  return client.db(process.env.MONGODB_DB ?? "zitutim");
}

/** Drops the cached connection. Only used to reset between test runs. */
export async function closeClient(): Promise<void> {
  const existing = global._mongoClientPromise;
  global._mongoClientPromise = undefined;
  if (existing) await (await existing).close();
}
