import { NextResponse } from "next/server";

import { fieldErrors } from "@/lib/api";
import { ConfigError } from "@/lib/config-error";
import { findUser, verifyPassword, type LdapFailureReason } from "@/lib/ldap";
import {
  clearFailures,
  clientIp,
  consumeAttempt,
  directoryKey,
  ipKey,
  refundAttempt,
} from "@/lib/login-throttle";
import {
  SESSION_COOKIE,
  isSameOrigin,
  forbiddenResponse,
  loginInputSchema,
  sessionCookieOptions,
  signSession,
} from "@/lib/session";
import { upsertUserFromDirectory } from "@/lib/users";

export const dynamic = "force-dynamic";

const CREDENTIALS_MESSAGE = "שם המשתמש או הסיסמה שגויים";

/**
 * Deliberately tells the reader it is not their problem. Nothing they can type
 * will fix an unset environment variable, and "try again later" would be a lie.
 */
const MISCONFIGURED_MESSAGE = "הכניסה לא מוגדרת בשרת. כדאי לפנות לתמיכה";

/**
 * `password-expired` and `must-change-password` are safe to name: AD validates
 * the password *before* reporting either, so both are only reachable by someone
 * who already has the correct one. `locked` does reveal the account exists, but
 * only to whoever caused the lockout — and hiding it just produces a support
 * queue of "it only ever says wrong password".
 *
 * Everything else collapses to one identical message, because distinguishing
 * "no such account" from "wrong password" is an account-enumeration oracle.
 */
const FAILURES: Record<
  LdapFailureReason,
  { status: number; message: string }
> = {
  credentials: { status: 401, message: CREDENTIALS_MESSAGE },
  "password-expired": {
    status: 401,
    message: "הסיסמה פגה. צריך להחליף אותה בחלונות ואז להתחבר שוב",
  },
  "must-change-password": {
    status: 401,
    message: "צריך להחליף סיסמה בחלונות לפני הכניסה הראשונה",
  },
  locked: {
    status: 401,
    message: "החשבון נעול. כדאי לפנות לתמיכה או לחכות לשחרור הנעילה",
  },
  // Kept distinct from a credential failure on purpose: otherwise a domain
  // controller going down looks like the whole company forgetting their
  // password at the same moment.
  unavailable: { status: 503, message: "לא הצלחנו להתחבר לשרת ההזדהות" },
  // And distinct from `unavailable` for the same kind of reason one step up:
  // a missing variable is not a directory outage, and saying it is sends the
  // investigation to the DC. 500 rather than 503 because nothing about it is
  // transient — retrying will never help.
  misconfigured: { status: 500, message: MISCONFIGURED_MESSAGE },
};

/**
 * A username that doesn't exist fails at the search (~5ms); a real one fails at
 * the bind (~50ms). Identical messages don't close that oracle, so hold every
 * failure open to a fixed floor. Tests set it to 0.
 */
async function holdFailure(startedAt: number): Promise<void> {
  const floor = Number(process.env.LOGIN_MIN_RESPONSE_MS ?? 500);
  const remaining = floor - (Date.now() - startedAt);
  if (remaining > 0) {
    await new Promise((resolve) => setTimeout(resolve, remaining));
  }
}

function noStore(response: NextResponse): NextResponse {
  // A corporate proxy must never cache a response carrying Set-Cookie.
  response.headers.set("Cache-Control", "no-store");
  return response;
}

export async function POST(request: Request) {
  const startedAt = Date.now();

  if (!isSameOrigin(request)) return noStore(forbiddenResponse());

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return noStore(
      NextResponse.json({ error: "בקשה לא תקינה" }, { status: 400 }),
    );
  }

  const parsed = loginInputSchema.safeParse(body);
  if (!parsed.success) {
    return noStore(
      NextResponse.json(
        { error: "יש שדות לא תקינים", issues: fieldErrors(parsed.error) },
        { status: 422 },
      ),
    );
  }

  const { username, password } = parsed.data;
  const ip = clientIp(request);

  /** Never log the request body — it contains a domain password. */
  const fail = async (reason: LdapFailureReason) => {
    console.warn(`Login failed for ${username}: ${reason}`);
    await holdFailure(startedAt);
    const { status, message } = FAILURES[reason];
    return noStore(NextResponse.json({ error: message }, { status }));
  };

  const tooMany = (retryAfterSeconds: number) =>
    noStore(
      NextResponse.json(
        { error: "יותר מדי ניסיונות. כדאי לנסות שוב בעוד כמה דקות" },
        {
          status: 429,
          headers: { "Retry-After": String(retryAfterSeconds) },
        },
      ),
    );

  try {
    // Volume damper first, where a client IP is trustworthy. Cheap, and it is
    // the only limit that applies before we know who is being asked for.
    if (ip) {
      const verdict = await consumeAttempt(ipKey(ip));
      if (!verdict.allowed) return tooMany(verdict.retryAfterSeconds);
    }

    // Resolve *before* throttling. The search runs as the service account and
    // never touches badPwdCount, so it is safe to do unmetered — and it is the
    // only way to learn which directory object the typed string refers to.
    // Throttling the string instead would give every alias of one account its
    // own budget: three tries as "dana" plus three as "dana@corp" is six binds
    // against a single object, past the lockout threshold the cap of 3 exists
    // to stay under.
    const found = await findUser(username);
    if (!found.ok) return fail(found.reason);

    const key = directoryKey(found.user.directoryId);

    // Spent before the bind, and atomically: counting and deciding in one step
    // is what stops concurrent requests from all reading the same pre-increment
    // count and all reaching the directory together.
    const verdict = await consumeAttempt(key);
    if (!verdict.allowed) {
      console.warn(`Login throttled for ${found.user.username}`);
      return tooMany(verdict.retryAfterSeconds);
    }

    const verified = await verifyPassword(found.user, password);

    if (!verified.ok) {
      // An outage isn't the user's fault, so hand the attempt back.
      if (verified.reason === "unavailable") await refundAttempt(key);
      return fail(verified.reason);
    }

    await clearFailures(key);
    if (ip) await clearFailures(ipKey(ip));

    const user = await upsertUserFromDirectory(found.user);
    const { token, expires } = await signSession(user);

    const response = NextResponse.json({ user });
    response.cookies.set(SESSION_COOKIE, token, sessionCookieOptions(expires));
    return noStore(response);
  } catch (error) {
    // signSession() is the one below that can throw a ConfigError, and it runs
    // *after* the directory has already said yes — so without this branch the
    // person whose password just worked is told the directory is unreachable.
    if (error instanceof ConfigError) {
      console.error("Login is misconfigured", error);
      return noStore(
        NextResponse.json({ error: MISCONFIGURED_MESSAGE }, { status: 500 }),
      );
    }

    console.error("POST /api/auth/login failed", error);
    return noStore(
      NextResponse.json(
        { error: "לא הצלחנו להתחבר לשרת ההזדהות" },
        { status: 503 },
      ),
    );
  }
}
