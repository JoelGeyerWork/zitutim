import { afterEach, describe, expect, it, vi } from "vitest";

import {
  SESSION_COOKIE,
  getSessionFrom,
  isSameOrigin,
  readSessionCookie,
  resetSessionKeyCache,
  sessionCookieOptions,
  signSession,
  verifySessionToken,
} from "@/lib/session";
import { type SessionUser } from "@/lib/auth-schema";

const USER: SessionUser = {
  id: "6b0000000000000000000001",
  name: "דנה כהן",
  username: "dana",
};

afterEach(() => {
  // NODE_ENV is read-only on process.env, so every env change here goes through
  // vi.stubEnv and is undone in one call.
  vi.unstubAllEnvs();
  resetSessionKeyCache();
});

function withSecret(value: string | undefined) {
  vi.stubEnv("SESSION_SECRET", value);
  resetSessionKeyCache();
}

describe("signSession / verifySessionToken", () => {
  it("round-trips a user", async () => {
    const { token } = await signSession(USER);
    await expect(verifySessionToken(token)).resolves.toEqual(USER);
  });

  it("returns the expiry alongside the token", async () => {
    vi.stubEnv("SESSION_TTL_HOURS", "8");
    const now = new Date("2026-08-09T09:00:00.000Z");
    const { expires } = await signSession(USER, now);
    expect(expires.toISOString()).toBe("2026-08-09T17:00:00.000Z");
  });

  it("returns null for a missing token", async () => {
    await expect(verifySessionToken(undefined)).resolves.toBeNull();
  });

  it("returns null for a tampered token", async () => {
    const { token } = await signSession(USER);
    const [header, payload, signature] = token.split(".");
    const forged = Buffer.from(
      JSON.stringify({ sub: "attacker", name: "x", username: "x" }),
    ).toString("base64url");
    await expect(
      verifySessionToken(`${header}.${forged}.${signature}`),
    ).resolves.toBeNull();
    expect(payload).not.toBe(forged);
  });

  it("returns null for an expired token", async () => {
    vi.stubEnv("SESSION_TTL_HOURS", "8");
    const longAgo = new Date(Date.now() - 9 * 60 * 60 * 1000);
    const { token } = await signSession(USER, longAgo);
    await expect(verifySessionToken(token)).resolves.toBeNull();
  });

  it("returns null when the token was signed with a different secret", async () => {
    const { token } = await signSession(USER);
    withSecret("a-completely-different-secret-32-chars");
    await expect(verifySessionToken(token)).resolves.toBeNull();
  });

  it('rejects an unsigned "alg: none" token', async () => {
    // The algorithm-confusion attack: a token whose header claims no signature
    // is required. Verifying must fail rather than trust the payload.
    const encode = (value: object) =>
      Buffer.from(JSON.stringify(value)).toString("base64url");
    const forged = `${encode({ alg: "none", typ: "JWT" })}.${encode({
      sub: "attacker",
      name: "מנהל",
      username: "admin",
      exp: Math.floor(Date.now() / 1000) + 3600,
    })}.`;

    await expect(verifySessionToken(forged)).resolves.toBeNull();
  });

  it("returns null when the payload is missing claims", async () => {
    // Signed with the right key but shaped wrong — must not produce a
    // half-populated SessionUser.
    const { SignJWT } = await import("jose");
    const token = await new SignJWT({ name: "דנה" })
      .setProtectedHeader({ alg: "HS256" })
      .setSubject("6b0000000000000000000001")
      .setExpirationTime("1h")
      .sign(new TextEncoder().encode(process.env.SESSION_SECRET!));

    await expect(verifySessionToken(token)).resolves.toBeNull();
  });

  it.each([
    ["unset", undefined],
    ["too short", "short"],
  ])("throws when SESSION_SECRET is %s", async (_label, value) => {
    withSecret(value);
    await expect(signSession(USER)).rejects.toThrow(/SESSION_SECRET/);
  });

  it("names the openssl command in the setup error", async () => {
    withSecret(undefined);
    await expect(signSession(USER)).rejects.toThrow(/openssl rand -base64 32/);
  });
});

describe("readSessionCookie", () => {
  it("picks the session cookie out of several", () => {
    const request = new Request("http://localhost:3000/api/quotes", {
      headers: { cookie: `theme=light; ${SESSION_COOKIE}=abc123; other=x` },
    });
    expect(readSessionCookie(request)).toBe("abc123");
  });

  it("percent-decodes the value", () => {
    const request = new Request("http://localhost:3000/api/quotes", {
      headers: { cookie: `${SESSION_COOKIE}=a%2Bb` },
    });
    expect(readSessionCookie(request)).toBe("a+b");
  });

  it("survives a value that is not valid percent-encoding", () => {
    // decodeURIComponent throws a URIError on a lone "%", and this runs above
    // the try/catch in verifySessionToken — unguarded it leaves the route as a
    // 500 with a stack trace instead of the intended 401.
    const request = new Request("http://localhost:3000/api/quotes", {
      headers: { cookie: `${SESSION_COOKIE}=%` },
    });

    expect(() => readSessionCookie(request)).not.toThrow();
    expect(readSessionCookie(request)).toBe("%");
  });

  it.each([
    ["no cookie header", undefined],
    ["an unrelated cookie", "theme=light"],
    ["a malformed header", "just-a-value; ;;"],
    ["a prefix collision", `not_${SESSION_COOKIE}=abc`],
  ])("returns undefined for %s", (_label, cookie) => {
    const request = new Request(
      "http://localhost:3000/api/quotes",
      cookie ? { headers: { cookie } } : undefined,
    );
    expect(readSessionCookie(request)).toBeUndefined();
  });
});

describe("getSessionFrom", () => {
  it("resolves the user from a request cookie", async () => {
    const { token } = await signSession(USER);
    const request = new Request("http://localhost:3000/api/quotes", {
      headers: { cookie: `${SESSION_COOKIE}=${token}` },
    });
    await expect(getSessionFrom(request)).resolves.toEqual(USER);
  });

  it("resolves null for an anonymous request", async () => {
    const request = new Request("http://localhost:3000/api/quotes");
    await expect(getSessionFrom(request)).resolves.toBeNull();
  });
});

describe("isSameOrigin", () => {
  function request(headers: Record<string, string>, url = "http://0.0.0.0:3000/api/quotes") {
    return new Request(url, { method: "POST", headers });
  }

  it("allows a request with no Origin at all", () => {
    // curl and the test suite; neither carries an ambient cookie to abuse.
    expect(isSameOrigin(request({ host: "zitutim.corp" }))).toBe(true);
  });

  it("compares against Host, not the server's own bind address", () => {
    // The blocker this replaced: Next builds request.url from where the server
    // is listening — `HOSTNAME=0.0.0.0` in the Dockerfile — so comparing Origin
    // to it 403s every browser that ever connects.
    expect(
      isSameOrigin(
        request({ host: "zitutim.corp", origin: "https://zitutim.corp" }),
      ),
    ).toBe(true);
  });

  it("prefers X-Forwarded-Host, which is what a proxy rewrites", () => {
    expect(
      isSameOrigin(
        request({
          host: "internal-service:3000",
          "x-forwarded-host": "zitutim.corp",
          origin: "https://zitutim.corp",
        }),
      ),
    ).toBe(true);
  });

  it("ignores the scheme, so TLS terminating at the proxy still matches", () => {
    expect(
      isSameOrigin(
        request({ host: "zitutim.corp", origin: "http://zitutim.corp" }),
      ),
    ).toBe(true);
  });

  it.each([
    ["another host", "https://evil.example"],
    ["a lookalike subdomain", "https://zitutim.corp.evil.example"],
    ["the right host on another port", "https://zitutim.corp:8443"],
    ["garbage", "not-a-url"],
    ["the null origin of a sandboxed frame", "null"],
  ])("rejects %s", (_label, origin) => {
    expect(isSameOrigin(request({ host: "zitutim.corp", origin }))).toBe(false);
  });

  it("rejects when there is an Origin but no Host to compare it to", () => {
    expect(isSameOrigin(request({ origin: "https://zitutim.corp" }))).toBe(
      false,
    );
  });
});

describe("sessionCookieOptions", () => {
  const expires = new Date("2026-08-09T17:00:00.000Z");

  it("is httpOnly, lax and host-only", () => {
    const options = sessionCookieOptions(expires);
    expect(options).toMatchObject({
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      expires,
    });
    expect(options).not.toHaveProperty("domain");
  });

  it.each([
    ["production", true],
    ["development", false],
    ["test", false],
  ])("sets secure=%s in %s", (env, expected) => {
    vi.stubEnv("NODE_ENV", env);
    // Unconditional `secure: true` silently breaks http://localhost — the
    // browser drops the cookie and login looks like it worked.
    expect(sessionCookieOptions(expires).secure).toBe(expected);
  });
});
