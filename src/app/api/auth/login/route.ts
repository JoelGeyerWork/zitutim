import { NextResponse } from "next/server";

import { fieldErrors } from "@/lib/api";
import { authenticate, type LdapFailureReason } from "@/lib/ldap";
import {
  checkThrottle,
  clearFailures,
  clientIp,
  ipKey,
  recordFailure,
  usernameKey,
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
  const keys = [usernameKey(username)];
  const ip = clientIp(request);
  if (ip) keys.push(ipKey(ip));

  try {
    // Checked before the bind, never after: the entire point is that a failed
    // attempt here never reaches Active Directory and never increments a real
    // employee's badPwdCount.
    for (const key of keys) {
      const verdict = await checkThrottle(key);
      if (!verdict.allowed) {
        return noStore(
          NextResponse.json(
            { error: "יותר מדי ניסיונות. כדאי לנסות שוב בעוד כמה דקות" },
            {
              status: 429,
              headers: { "Retry-After": String(verdict.retryAfterSeconds) },
            },
          ),
        );
      }
    }

    const result = await authenticate(username, password);

    if (!result.ok) {
      // An outage isn't the user's fault, so it must not spend their budget.
      if (result.reason !== "unavailable") {
        await Promise.all(keys.map((key) => recordFailure(key)));
      }

      // Never log the request body — it contains a domain password. Keep any
      // future `catch` in this file to the same rule.
      console.warn(`Login failed for ${username}: ${result.reason}`);

      await holdFailure(startedAt);
      const { status, message } = FAILURES[result.reason];
      return noStore(NextResponse.json({ error: message }, { status }));
    }

    await Promise.all(keys.map((key) => clearFailures(key)));

    const user = await upsertUserFromDirectory(result.user);
    const { token, expires } = await signSession(user);

    const response = NextResponse.json({ user });
    response.cookies.set(SESSION_COOKIE, token, sessionCookieOptions(expires));
    return noStore(response);
  } catch (error) {
    console.error("POST /api/auth/login failed", error);
    return noStore(
      NextResponse.json(
        { error: "לא הצלחנו להתחבר לשרת ההזדהות" },
        { status: 503 },
      ),
    );
  }
}
