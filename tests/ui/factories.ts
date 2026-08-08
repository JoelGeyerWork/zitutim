import type { Quote } from "@/lib/quote-schema";

export function makeQuote(overrides: Partial<Quote> = {}): Quote {
  return {
    id: "6a0000000000000000000001",
    text: "תמיד יש זמן לעוד קפה אחד",
    author: "דנה",
    saidAt: "2026-07-28T00:00:00.000Z",
    context: null,
    addedBy: null,
    createdAt: "2026-08-08T09:00:00.000Z",
    updatedAt: "2026-08-08T09:00:00.000Z",
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
