import { SESSION_COOKIE, signSession } from "@/lib/session";
import { type SessionUser } from "@/lib/auth-schema";

export const TEST_USER: SessionUser = {
  id: "6b0000000000000000000001",
  name: "דנה כהן",
  username: "dana",
};

/**
 * A real signed token rather than a stub, so tests exercise the actual verify
 * path rather than a shape that only resembles one.
 */
export async function sessionCookie(
  user: SessionUser = TEST_USER,
): Promise<string> {
  const { token } = await signSession(user);
  return `${SESSION_COOKIE}=${token}`;
}

/** Same as `new Request`, with a signed session attached. */
export async function authedRequest(
  url: string,
  init: RequestInit = {},
  user: SessionUser = TEST_USER,
): Promise<Request> {
  return new Request(url, {
    ...init,
    headers: {
      ...(init.headers as Record<string, string> | undefined),
      cookie: await sessionCookie(user),
    },
  });
}
