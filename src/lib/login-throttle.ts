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
  /** "user:<directoryId>" or "ip:10.0.0.1". */
  key: string;
  failures: number;
  firstAt: Date;
  expiresAt: Date;
}

async function attempts(): Promise<Collection<AttemptDoc>> {
  const db = await getDb();
  return db.collection<AttemptDoc>("login_attempts");
}

/**
 * Keyed on the directory's own immutable id, not on what was typed.
 *
 * `LDAP_LOGIN_ATTRS` matches several attributes for one account, so a bucket
 * per typed string would hand every alias its own allowance: three attempts as
 * `dana` plus three as `dana@corp` is six binds against one object, past the
 * lockout threshold the cap of 3 is specifically chosen to stay under. Every
 * additional login attribute would multiply the budget again.
 */
export function directoryKey(directoryId: string): string {
  return `user:${directoryId.toLowerCase()}`;
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

/**
 * Spend one attempt against `key` and say whether it may proceed.
 *
 * Counting and deciding are **one** database round trip, on purpose. A separate
 * check-then-act — read the count, decide, bind, then record the failure —
 * leaves the whole bind sitting inside the gap: twenty concurrent requests for
 * one username all read a count of zero, all pass, and all twenty reach the
 * directory. That is the anonymous lockout this module exists to prevent, and
 * it needs nothing more sophisticated than a `for` loop and an ampersand.
 *
 * Callers must therefore consume *before* binding, and `refund` on an outage.
 */
export async function consumeAttempt(
  key: string,
  now: Date = new Date(),
): Promise<ThrottleVerdict> {
  const collection = await attempts();
  const limit = limitFor(key);
  const renewed = new Date(now.getTime() + WINDOW_MS);

  // Two pipeline stages, because the second needs to see the count the first
  // produced — a single `$set` computes every field against the *input*
  // document.
  const doc = await collection.findOneAndUpdate(
    { key },
    [
      {
        // "Increment, or start again if the window already lapsed", atomically.
        // A plain `$inc` cannot express the reset, and would keep incrementing a
        // stale document forever: three failures, wait out the ten minutes, fail
        // once more, and the count reaches four — throttled again having spent a
        // single attempt.
        $set: {
          failures: {
            $cond: [
              { $gt: ["$expiresAt", now] },
              { $add: [{ $ifNull: ["$failures", 0] }, 1] },
              1,
            ],
          },
          firstAt: {
            $cond: [
              { $gt: ["$expiresAt", now] },
              { $ifNull: ["$firstAt", now] },
              now,
            ],
          },
        },
      },
      {
        // The window is only pushed forward by an attempt that was *allowed*.
        // Renewing it unconditionally means a rejected attempt extends its own
        // lockout, so it never drains: the 429 tells people to try again in a
        // few minutes, and doing exactly that resets the clock every time.
        // There is then no waiting strategy that ever works, and nothing in the
        // response explaining why.
        $set: {
          expiresAt: {
            $cond: [
              { $lte: ["$failures", limit] },
              renewed,
              { $ifNull: ["$expiresAt", renewed] },
            ],
          },
        },
      },
    ],
    { upsert: true, returnDocument: "after" },
  );

  const failures = doc?.failures ?? 1;
  if (failures <= limit) {
    return { allowed: true, retryAfterSeconds: 0 };
  }

  // Measured from the stored expiry, not a freshly computed one, or this is
  // structurally always the full window and can never count down.
  const expiresAt = doc?.expiresAt?.getTime() ?? renewed.getTime();
  return {
    allowed: false,
    retryAfterSeconds: Math.max(
      1,
      Math.ceil((expiresAt - now.getTime()) / 1000),
    ),
  };
}

/**
 * Hand an attempt back. A directory outage is not the user's fault, so it must
 * not push them toward a lockout they can do nothing about.
 */
export async function refundAttempt(key: string): Promise<void> {
  const collection = await attempts();
  await collection.updateOne(
    { key, failures: { $gt: 0 } },
    { $inc: { failures: -1 } },
  );
}

export async function clearFailures(key: string): Promise<void> {
  const collection = await attempts();
  await collection.deleteOne({ key });
}
