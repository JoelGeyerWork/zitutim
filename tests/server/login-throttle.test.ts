import { beforeEach, describe, expect, it, vi } from "vitest";

import { getDb } from "@/lib/mongodb";
import {
  checkThrottle,
  clearFailures,
  clientIp,
  ipKey,
  recordFailure,
  usernameKey,
} from "@/lib/login-throttle";

const KEY = usernameKey("dana");

beforeEach(async () => {
  const db = await getDb();
  await db.collection("login_attempts").deleteMany({});
  vi.unstubAllEnvs();
});

describe("keys", () => {
  it("normalises the username so case and padding can't buy extra attempts", () => {
    expect(usernameKey("  DaNa  ")).toBe("user:dana");
  });

  it("namespaces ip keys apart from username keys", () => {
    expect(ipKey("10.0.0.1")).toBe("ip:10.0.0.1");
  });
});

describe("checkThrottle / recordFailure", () => {
  it("allows an unseen key", async () => {
    await expect(checkThrottle(KEY)).resolves.toEqual({
      allowed: true,
      retryAfterSeconds: 0,
    });
  });

  it("allows attempts up to the username limit", async () => {
    // Three is deliberately below a typical AD lockout threshold of five, so
    // this app can never be what trips AD's counter.
    await recordFailure(KEY);
    await expect(checkThrottle(KEY)).resolves.toMatchObject({ allowed: true });
    await recordFailure(KEY);
    await expect(checkThrottle(KEY)).resolves.toMatchObject({ allowed: true });
  });

  it("blocks once the username limit is reached", async () => {
    await recordFailure(KEY);
    await recordFailure(KEY);
    await recordFailure(KEY);

    const verdict = await checkThrottle(KEY);
    expect(verdict.allowed).toBe(false);
    expect(verdict.retryAfterSeconds).toBeGreaterThan(0);
    expect(verdict.retryAfterSeconds).toBeLessThanOrEqual(600);
  });

  it("allows a much higher count per IP", async () => {
    const ip = ipKey("10.0.0.1");
    for (let i = 0; i < 19; i += 1) await recordFailure(ip);

    await expect(checkThrottle(ip)).resolves.toMatchObject({ allowed: true });
    await recordFailure(ip);
    await expect(checkThrottle(ip)).resolves.toMatchObject({ allowed: false });
  });

  it("counts concurrent failures without losing any", async () => {
    // A read-then-write implementation loses increments here, and each lost one
    // is an extra bind against a real AD account.
    await Promise.all(Array.from({ length: 5 }, () => recordFailure(KEY)));

    const db = await getDb();
    const doc = await db
      .collection<{ failures: number }>("login_attempts")
      .findOne({ key: KEY });
    expect(doc?.failures).toBe(5);
  });

  it("lets the window lapse", async () => {
    const longAgo = new Date(Date.now() - 20 * 60 * 1000);
    await recordFailure(KEY, longAgo);
    await recordFailure(KEY, longAgo);
    await recordFailure(KEY, longAgo);

    await expect(checkThrottle(KEY)).resolves.toMatchObject({ allowed: true });
  });

  it("resets on a successful login", async () => {
    await recordFailure(KEY);
    await recordFailure(KEY);
    await recordFailure(KEY);
    await expect(checkThrottle(KEY)).resolves.toMatchObject({ allowed: false });

    await clearFailures(KEY);

    await expect(checkThrottle(KEY)).resolves.toMatchObject({ allowed: true });
  });

  it("throttles each username separately", async () => {
    await recordFailure(KEY);
    await recordFailure(KEY);
    await recordFailure(KEY);

    await expect(checkThrottle(usernameKey("omer"))).resolves.toMatchObject({
      allowed: true,
    });
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
