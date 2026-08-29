import "server-only";

import { cache } from "react";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { SignJWT, jwtVerify } from "jose";

import { type SessionUser } from "@/lib/auth-schema";
import { ConfigError } from "@/lib/config-error";

export * from "@/lib/auth-schema";

export const SESSION_COOKIE = "zitutim_session";

// Section-neutral on purpose. This was written for the quote wall and said
// "את הקיר", then followed `unauthorizedResponse()` into themes, both rotations
// and the two שוטף tabs — where it told people to sign in to change a wall they
// were nowhere near. Every write control is drawn signed-out now, so this
// string is the one most readers ever see.
export const UNAUTHORIZED_MESSAGE = "צריך להתחבר כדי לשנות משהו כאן";
export const FORBIDDEN_MESSAGE = "בקשה נדחתה";

const DEFAULT_TTL_HOURS = 8;

/**
 * Read the secret lazily rather than at module scope. The Next docs' own
 * example encodes `process.env.SESSION_SECRET` at import time, which captures
 * `undefined` here: the vitest server project sets env in `beforeAll`, after
 * imports have run. Same reasoning as `getClient()` in mongodb.ts.
 */
let cachedKey: Uint8Array | undefined;

function secret(): Uint8Array {
  if (cachedKey) return cachedKey;

  const value = process.env.SESSION_SECRET;
  // The length floor is load-bearing, not hygiene: HS256 with a short secret is
  // brute-forceable offline from a single captured cookie, and nothing else in
  // the system would ever signal that it had happened.
  if (!value || value.length < 32) {
    throw new ConfigError(
      "SESSION_SECRET is not set (needs 32+ chars). Generate one: openssl rand -base64 32",
    );
  }

  cachedKey = new TextEncoder().encode(value);
  return cachedKey;
}

/**
 * Force the lazy read, for `instrumentation.ts`. Reaching this at boot is the
 * whole point: otherwise an unset secret first surfaces on the line *after* a
 * successful bind, as a 503 blaming the directory.
 */
export function assertSessionConfigured(): void {
  secret();
}

/** Only for tests, which swap the secret between cases. */
export function resetSessionKeyCache(): void {
  cachedKey = undefined;
}

export function sessionTtlSeconds(): number {
  const hours = Number(process.env.SESSION_TTL_HOURS) || DEFAULT_TTL_HOURS;
  return Math.round(hours * 60 * 60);
}

export interface SessionCookieOptions {
  httpOnly: true;
  secure: boolean;
  sameSite: "lax";
  path: "/";
  expires: Date;
}

export function sessionCookieOptions(expires: Date): SessionCookieOptions {
  return {
    httpOnly: true,
    // Not unconditionally true, as the Next docs example has it: on
    // http://localhost:3000 the browser silently drops a Secure cookie, so
    // login appears to succeed while the nav still says signed out.
    secure: process.env.NODE_ENV === "production",
    // "lax", not "strict": strict drops the cookie on a top-level navigation in
    // from Slack or Teams, landing a signed-in user on the feed logged out.
    sameSite: "lax",
    path: "/",
    // Matches the JWT `exp` so the browser stops sending a token that can no
    // longer verify.
    expires,
  };
}

/**
 * Only the minimum needed to render and to attribute a write. No mail, no DN,
 * no group memberships: the cookie is httpOnly but it is still handed to the
 * client, and every extra claim is an identity leak if it is ever read.
 *
 * Carrying `name` means the nav renders without a database hit on the public
 * hot path. The cost is that an AD display-name change doesn't show until the
 * next login — the same staleness the `addedBy` snapshot already has.
 */
export async function signSession(
  user: SessionUser,
  now: Date = new Date(),
): Promise<{ token: string; expires: Date }> {
  const expires = new Date(now.getTime() + sessionTtlSeconds() * 1000);

  const token = await new SignJWT({ name: user.name, username: user.username })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(user.id)
    .setIssuedAt(now)
    .setExpirationTime(expires)
    .sign(secret());

  return { token, expires };
}

export async function verifySessionToken(
  token: string | undefined,
): Promise<SessionUser | null> {
  if (!token) return null;

  try {
    const { payload } = await jwtVerify(token, secret(), {
      // Pinning the algorithm is what closes the algorithm-confusion class.
      // jose already rejects `alg: none`; pin anyway.
      algorithms: ["HS256"],
    });

    const { sub, name, username } = payload;
    if (
      typeof sub !== "string" ||
      typeof name !== "string" ||
      typeof username !== "string"
    ) {
      return null;
    }

    return { id: sub, name, username };
  } catch {
    // Tampered, expired, wrong secret — all indistinguishable to a caller, and
    // all mean the same thing: no session.
    return null;
  }
}

/**
 * Pull the session cookie straight off a `Request`.
 *
 * Route handlers use this rather than `next/headers` because the server test
 * suite calls handlers directly with plain `Request` objects — there is no Next
 * request scope, so `await cookies()` would throw and take the whole suite
 * down. It also keeps `next/headers` confined to `getSession()` below.
 */
export function readSessionCookie(request: Request): string | undefined {
  const header = request.headers.get("cookie");
  if (!header) return undefined;

  for (const part of header.split(";")) {
    const separator = part.indexOf("=");
    if (separator === -1) continue;
    if (part.slice(0, separator).trim() !== SESSION_COOKIE) continue;

    const value = part.slice(separator + 1).trim();
    try {
      return decodeURIComponent(value);
    } catch {
      // A malformed escape ("%") makes decodeURIComponent throw, and this sits
      // above the try/catch in verifySessionToken — unguarded it escapes the
      // route handler as a 500 with a stack trace instead of the intended 401.
      // A JWT is base64url and never needs decoding anyway.
      return value;
    }
  }

  return undefined;
}

/** For route handlers. */
export async function getSessionFrom(
  request: Request,
): Promise<SessionUser | null> {
  return verifySessionToken(readSessionCookie(request));
}

/**
 * For server components. `cache` memoizes per render pass, so the layout and
 * the page share one verification.
 */
export const getSession = cache(async (): Promise<SessionUser | null> => {
  const store = await cookies();
  return verifySessionToken(store.get(SESSION_COOKIE)?.value);
});

export function unauthorizedResponse(): NextResponse {
  return NextResponse.json({ error: UNAUTHORIZED_MESSAGE }, { status: 401 });
}

export function forbiddenResponse(): NextResponse {
  return NextResponse.json({ error: FORBIDDEN_MESSAGE }, { status: 403 });
}

/**
 * Cheap CSRF hardening on top of SameSite=Lax. Browsers send `Origin` on every
 * cross-origin fetch, so a mismatch is a cross-site write attempt.
 *
 * Compared against the `Host` header — the name the *client* asked for — and
 * not against `new URL(request.url)`, which Next builds from the server's own
 * bind address. Behind a reverse proxy, or in the container where the Dockerfile
 * sets `HOSTNAME=0.0.0.0`, that URL is `http://0.0.0.0:3000` and never matches
 * any real browser's Origin, so every write would 403. This is the same
 * comparison Next itself makes for Server Actions.
 *
 * `X-Forwarded-Host` wins when present because a proxy rewrites `Host`. Neither
 * header being attacker-controlled matters here: a browser performing a
 * cross-site request sends its own `Origin` and our `Host`, so they differ and
 * it is blocked. Anything able to forge both headers is not doing CSRF.
 *
 * An absent `Origin` is allowed: that means a non-browser client (curl, the
 * test suite), which carries no ambient cookie to abuse in the first place.
 */
export function isSameOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");
  if (!origin) return true;

  const host =
    request.headers.get("x-forwarded-host") ?? request.headers.get("host");
  if (!host) return false;

  try {
    // Host to host, so http/https in front of the proxy doesn't matter.
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}
