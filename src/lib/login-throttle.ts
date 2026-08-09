import "server-only";

import { type Collection } from "mongodb";

import { getDb } from "@/lib/mongodb";

/**
 * Rate limiting for the login route.
 *
 * This is not ordinary abuse prevention: every failed bind increments the real
 * `badPwdCount` on a real Active Directory account. Without a throttle in front
 * of it, any anonymous visitor could iterate usernames and lock the entire
 * company out of *Windows* — an unauthenticated denial-of-service against the
 * business, launched from a quote wall.
 *
 * So the per-username limit sits deliberately below the AD lockout threshold:
 * this app must never be the thing that trips AD's counter.
 *
 * Accepted residual: someone can deliberately trip a colleague's throttle to
 * keep them off the wall for ten minutes. That is the right trade against
 * thirty minutes locked out of Windows.
 */
const WINDOW_MS = 10 * 60 * 1000;

/** Typical AD policy allows 5. Staying under it is the whole point. */
const MAX_USERNAME_FAILURES = 3;

/** Per-IP is about blunting enumeration volume, so it can be looser. */
const MAX_IP_FAILURES = 20;

interface AttemptDoc {
  /** "user:dana" or "ip:10.0.0.1". */
  key: string;
  failures: number;
  firstAt: Date;
  expiresAt: Date;
}

async function attempts(): Promise<Collection<AttemptDoc>> {
  const db = await getDb();
  return db.collection<AttemptDoc>("login_attempts");
}

export function usernameKey(username: string): string {
  return `user:${username.trim().toLowerCase()}`;
}

export function ipKey(ip: string): string {
  return `ip:${ip}`;
}

function limitFor(key: string): number {
  return key.startsWith("ip:") ? MAX_IP_FAILURES : MAX_USERNAME_FAILURES;
}

/**
 * Best-effort client IP.
 *
 * `x-forwarded-for` is client-controlled unless a proxy overwrites it, so this
 * is only consulted when the deployment says a trusted proxy is in front. It is
 * a volume damper, never a security boundary — the per-username limit is what
 * actually protects AD accounts.
 */
export function clientIp(request: Request): string | null {
  if (process.env.LOGIN_TRUSTED_PROXY !== "true") return null;

  const forwarded = request.headers.get("x-forwarded-for");
  const first = forwarded?.split(",")[0]?.trim();
  return first || null;
}

export interface ThrottleVerdict {
  allowed: boolean;
  retryAfterSeconds: number;
}

export async function checkThrottle(key: string): Promise<ThrottleVerdict> {
  const collection = await attempts();
  const doc = await collection.findOne({ key });

  if (!doc || doc.expiresAt.getTime() <= Date.now()) {
    return { allowed: true, retryAfterSeconds: 0 };
  }

  if (doc.failures < limitFor(key)) {
    return { allowed: true, retryAfterSeconds: 0 };
  }

  return {
    allowed: false,
    retryAfterSeconds: Math.max(
      1,
      Math.ceil((doc.expiresAt.getTime() - Date.now()) / 1000),
    ),
  };
}

export async function recordFailure(
  key: string,
  now: Date = new Date(),
): Promise<void> {
  const collection = await attempts();

  // `$inc` rather than read-then-write: two concurrent requests reading the
  // same count would both see themselves as under the limit and both proceed.
  await collection.updateOne(
    { key },
    {
      $inc: { failures: 1 },
      $set: { expiresAt: new Date(now.getTime() + WINDOW_MS) },
      $setOnInsert: { firstAt: now },
    },
    { upsert: true },
  );
}

export async function clearFailures(key: string): Promise<void> {
  const collection = await attempts();
  await collection.deleteOne({ key });
}
