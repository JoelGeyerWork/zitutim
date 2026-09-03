import { SESSION_COOKIE, signSession } from "@/lib/session";
import { type SessionUser } from "@/lib/auth-schema";
import { type QuoteAuthorRef } from "@/lib/quote-schema";
import { type QuoteAuthor } from "@/lib/quotes";

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

/**
 * A speaker named by hand — the `author` arm that resolves to itself.
 *
 * The two halves come apart at the route: the body carries a reference and the
 * data layer takes the resolved author, so a test that only needs *a* quote by
 * *a* name asks for both here rather than seeding a `users` row or mocking the
 * directory for a fact it is not testing.
 */
export function nameRef(name: string): QuoteAuthorRef {
  return { source: "name", name };
}

export function namedAuthor(name: string): QuoteAuthor {
  return { id: null, name };
}
