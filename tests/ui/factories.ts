import type { Quote } from "@/lib/quote-schema";
import type { QuoteComment } from "@/lib/engagement-schema";
import type {
  Standing,
  Theme,
  ThemeMember,
} from "@/lib/theme-schema";
import type { SessionUser } from "@/lib/auth-schema";

export function makeQuote(overrides: Partial<Quote> = {}): Quote {
  return {
    id: "6a0000000000000000000001",
    text: "תמיד יש זמן לעוד קפה אחד",
    author: "דנה",
    saidAt: "2026-07-28T00:00:00.000Z",
    context: null,
    addedBy: null,
    addedById: null,
    updatedBy: null,
    updatedById: null,
    createdAt: "2026-08-08T09:00:00.000Z",
    updatedAt: "2026-08-08T09:00:00.000Z",
    likeCount: 0,
    commentCount: 0,
    likedByViewer: false,
    commentsPreview: [],
    ...overrides,
  };
}

export function makeSessionUser(
  overrides: Partial<SessionUser> = {},
): SessionUser {
  return {
    id: "6b0000000000000000000001",
    name: "דנה כהן",
    username: "dana",
    ...overrides,
  };
}

export function makeComment(
  overrides: Partial<QuoteComment> = {},
): QuoteComment {
  return {
    id: "7c0000000000000000000001",
    quoteId: "6a0000000000000000000001",
    authorId: "6b0000000000000000000001",
    authorName: "דנה כהן",
    text: "תגובה טובה",
    createdAt: "2026-08-20T09:00:00.000Z",
    updatedAt: "2026-08-20T09:00:00.000Z",
    ...overrides,
  };
}

export function makeTheme(overrides: Partial<Theme> = {}): Theme {
  return {
    id: "7a0000000000000000000001",
    date: "2026-08-18T00:00:00.000Z",
    broughtById: "6b0000000000000000000001",
    broughtBy: "נועה ברקת",
    theme: "הכול עגול",
    snacks: ["בייגלה", "דונאטס"],
    guessedById: null,
    guessedBy: null,
    addedBy: null,
    addedById: null,
    updatedBy: null,
    updatedById: null,
    createdAt: "2026-08-18T09:00:00.000Z",
    updatedAt: "2026-08-18T09:00:00.000Z",
    ...overrides,
  };
}

export function makeThemeMember(
  overrides: Partial<ThemeMember> = {},
): ThemeMember {
  return {
    id: "6b0000000000000000000001",
    name: "נועה ברקת",
    role: "ראשת צוות",
    gender: "f",
    ...overrides,
  };
}

export function makeStanding(overrides: Partial<Standing> = {}): Standing {
  return {
    id: "6b0000000000000000000001",
    name: "נועה ברקת",
    role: "ראשת צוות",
    guesses: 0,
    lastGuess: null,
    ...overrides,
  };
}

export function jsonResponse(body: unknown, status = 200): Response {
  return new Response(status === 204 ? null : JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

/**
 * A `fetch` implementation that returns a *fresh* Response every call. Use this
 * with `mockImplementation` rather than handing `mockResolvedValue` a single
 * Response — a body can only be consumed once, so the second call would fail.
 */
export function respondWith(body: unknown, status = 200) {
  return async () => jsonResponse(body, status);
}
