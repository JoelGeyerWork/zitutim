import { z } from "zod";

/**
 * Types, constants and validation shared by the server and the browser.
 * Deliberately free of `mongodb`, `jose`, `ldapts` and `next/headers` so client
 * components can use it — the same split `quote-schema.ts` keeps.
 */

/** Shape handed to the client. Everything here is safe to render. */
export interface SessionUser {
  /** `users._id` as a hex string — what quotes, comments and likes reference. */
  id: string;
  /** AD displayName. The source of the `addedBy` snapshot on a quote. */
  name: string;
  /** sAMAccountName, lowercased. Shown in the account menu. */
  username: string;
}

export const loginInputSchema = z.object({
  username: z
    .string()
    .trim()
    .min(1, "צריך שם משתמש")
    .max(256, "שם המשתמש ארוך מדי"),
  // Not trimmed: trailing spaces can be part of a legitimate password, and
  // silently mangling it produces a login that fails for no visible reason.
  password: z.string().min(1, "צריך סיסמה").max(512, "הסיסמה ארוכה מדי"),
});

export type LoginInput = z.input<typeof loginInputSchema>;
export type LoginValues = z.output<typeof loginInputSchema>;

/**
 * Clamp a `?next=` value to a same-origin path before redirecting to it.
 *
 * `new URL(value, origin)` is not a guard — it happily resolves "//evil.com"
 * to another host, which is the classic form of this bug. Each rejected case
 * below passes a naive `startsWith("/")` check.
 */
export function safeNext(value: string | null | undefined): string {
  if (!value) return "/";
  // "https://evil.com", "javascript:alert(1)", "evil.com"
  if (!value.startsWith("/")) return "/";
  // Protocol-relative: "//evil.com" is a different host.
  if (value.startsWith("//")) return "/";
  // Browsers normalise backslashes to slashes, so "/\evil.com" is "//evil.com".
  if (value.startsWith("/\\")) return "/";
  return value;
}
