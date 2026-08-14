import { beforeEach, describe, expect, it, vi } from "vitest";

import { getDb } from "@/lib/mongodb";
import {
  clearFailures,
  clientIp,
  consumeAttempt,
  directoryKey,
  ipKey,
  refundAttempt,
} from "@/lib/login-throttle";

const GUID = "03020100-0504-0706-0809-0a0b0c0d0e0f";
const KEY = directoryKey(GUID);

async function failures(key: string): Promise<number | undefined> {
  const db = await getDb();
  const doc = await db
    .collection<{ failures: number }>("login_attempts")
    .findOne({ key });
  return doc?.failures;
}

beforeEach(async () => {
  const db = await getDb();
  await db.collection("login_attempts").deleteMany({});
  vi.unstubAllEnvs();
});

describe("keys", () => {
  it("is keyed on the directory id, not the typed username", () => {
    // Every alias of one account has to land in the same bucket, or each alias
    // gets its own budget against a single directory object.
    expect(directoryKey(GUID)).toBe(`user:${GUID}`);
    expect(directoryKey(GUID.toUpperCase())).toBe(directoryKey(GUID));
  });

  it("namespaces ip keys apart from user keys", () => {
    expect(ipKey("10.0.0.1")).toBe("ip:10.0.0.1");
  });
});

describe("consumeAttempt", () => {
  it("allows attempts up to the limit, then blocks", async () => {
    // Three is deliberately below a typical AD lockout threshold of five, so
    // this app can never be what trips AD's counter.
    for (let i = 0; i < 3; i += 1) {
      await expect(consumeAttempt(KEY)).resolves.toMatchObject({
        allowed: true,
      });
    }

    const verdict = await consumeAttempt(KEY);
    expect(verdict.allowed).toBe(false);
    expect(verdict.retryAfterSeconds).toBeGreaterThan(0);
    expect(verdict.retryAfterSeconds).toBeLessThanOrEqual(600);
  });

  it("lets only the limit through when every request arrives at once", async () => {
    // The reason counting and deciding are one atomic step. A check-then-act
    // implementation lets all twenty read a count of zero, pass, and bind —
    // which is the anonymous lockout this module exists to prevent.
    const verdicts = await Promise.all(
      Array.from({ length: 20 }, () => consumeAttempt(KEY)),
    );

    expect(verdicts.filter((v) => v.allowed)).toHaveLength(3);
    expect(await failures(KEY)).toBe(20);
  });

  it("allows a much higher count per IP", async () => {
    const ip = ipKey("10.0.0.1");
    for (let i = 0; i < 20; i += 1) {
      await expect(consumeAttempt(ip)).resolves.toMatchObject({
        allowed: true,
      });
    }
    await expect(consumeAttempt(ip)).resolves.toMatchObject({ allowed: false });
  });

  it("restarts the count once the window has lapsed", async () => {
    // Not merely "allowed again": a lapsed window that only gets extended puts
    // the count at 4 after a single further mistake, throttling immediately and
    // for good — the TTL sweep being the only thing that ever resets it.
    const longAgo = new Date(Date.now() - 20 * 60 * 1000);
    for (let i = 0; i < 3; i += 1) await consumeAttempt(KEY, longAgo);

    await expect(consumeAttempt(KEY)).resolves.toMatchObject({ allowed: true });
    expect(await failures(KEY)).toBe(1);

    // And a full budget follows, rather than one attempt before the wall.
    await expect(consumeAttempt(KEY)).resolves.toMatchObject({ allowed: true });
    await expect(consumeAttempt(KEY)).resolves.toMatchObject({ allowed: true });
    await expect(consumeAttempt(KEY)).resolves.toMatchObject({
      allowed: false,
    });
  });

  it("does not depend on the TTL index to reset", async () => {
    // The TTL index only exists where `npm run db:seed` has been run, and Mongo
    // sweeps up to a minute late either way.
    const longAgo = new Date(Date.now() - 20 * 60 * 1000);
    await consumeAttempt(KEY, longAgo);
    await consumeAttempt(KEY, longAgo);
    await consumeAttempt(KEY, longAgo);

    // Document still present, still holding a stale count.
    expect(await failures(KEY)).toBe(3);
    await expect(consumeAttempt(KEY)).resolves.toMatchObject({ allowed: true });
  });

  it("throttles each account separately", async () => {
    for (let i = 0; i < 4; i += 1) await consumeAttempt(KEY);

    await expect(
      consumeAttempt(directoryKey("ffffffff-0000-1111-2222-333344445555")),
    ).resolves.toMatchObject({ allowed: true });
  });
});

describe("refundAttempt", () => {
  it("hands an attempt back", async () => {
    await consumeAttempt(KEY);
    await consumeAttempt(KEY);
    await refundAttempt(KEY);

    expect(await failures(KEY)).toBe(1);
  });

  it("never goes negative", async () => {
    await refundAttempt(KEY);
    expect(await failures(KEY)).toBeUndefined();

    await consumeAttempt(KEY);
    await refundAttempt(KEY);
    await refundAttempt(KEY);
    expect(await failures(KEY)).toBe(0);
  });

  it("keeps a directory outage from spending the budget", async () => {
    // Consume-then-refund has to leave the user exactly where they started, or
    // a DC being down walks them toward a lockout they can do nothing about.
    for (let i = 0; i < 10; i += 1) {
      await consumeAttempt(KEY);
      await refundAttempt(KEY);
    }

    await expect(consumeAttempt(KEY)).resolves.toMatchObject({ allowed: true });
  });
});

describe("clearFailures", () => {
  it("resets after a successful login", async () => {
    for (let i = 0; i < 4; i += 1) await consumeAttempt(KEY);
    await expect(consumeAttempt(KEY)).resolves.toMatchObject({
      allowed: false,
    });

    await clearFailures(KEY);

    await expect(consumeAttempt(KEY)).resolves.toMatchObject({ allowed: true });
  });
});

describe("clientIp", () => {
  function request(headers: Record<string, string> = {}) {
    return new Request("http://localhost:3000/api/auth/login", { headers });
  }

  it("ignores x-forwarded-for unless a trusted proxy is declared", () => {
    // The header is client-controlled otherwise, so believing it would let an
    // attacker mint a fresh throttle bucket per request.
    expect(clientIp(request({ "x-forwarded-for": "10.0.0.1" }))).toBeNull();
  });

  it("reads the first hop when a trusted proxy is declared", () => {
    vi.stubEnv("LOGIN_TRUSTED_PROXY", "true");

    expect(
      clientIp(request({ "x-forwarded-for": "10.0.0.1, 172.16.0.9" })),
    ).toBe("10.0.0.1");
  });

  it("returns null when the header is absent", () => {
    vi.stubEnv("LOGIN_TRUSTED_PROXY", "true");

    expect(clientIp(request())).toBeNull();
  });
});
