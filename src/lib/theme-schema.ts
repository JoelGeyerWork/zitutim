import { z } from "zod";

import { dateOnly } from "@/lib/quote-schema";

/**
 * Types, constants and validation shared by the server and the browser.
 * Deliberately free of any `mongodb` import so client components can use it —
 * the same split `quote-schema.ts` keeps against `quotes.ts`.
 */

/** Shape sent to the client — ObjectId and Dates flattened to strings. */
export interface Theme {
  id: string;
  /** UTC midnight ISO — the meetup this was the theme of. */
  date: string;
  /** `users._id` of whoever brought the refreshments. */
  broughtById: string;
  /**
   * Display-name snapshot of the person who brought it, like `addedBy` on a
   * quote: rendered directly, and the historically accurate name if that person
   * is later renamed or leaves. Never resolved through a `$lookup` on read.
   */
  broughtBy: string;
  theme: string;
  snacks: string[];
  /** `users._id` of the guesser, or null while unsolved. */
  guessedById: string | null;
  /** Display-name snapshot of the guesser. Null while unsolved. */
  guessedBy: string | null;
  /**
   * Who typed the record in — a different axis from `broughtBy`. Whoever logs a
   * theme is rarely who brought the snacks. Null on seeded rows.
   */
  addedBy: string | null;
  addedById: string | null;
  updatedBy: string | null;
  updatedById: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ThemePage {
  themes: Theme[];
  total: number;
  hasMore: boolean;
}

/**
 * A roster person as the picker and the leaderboard need them: the real
 * `users._id` the form posts, plus the name, role and grammatical gender the
 * directory row has no concept of. `gender` drives Hebrew conjugation only —
 * names always come from the snapshot, never from here.
 */
export interface ThemeMember {
  /** `users._id` as a hex string. */
  id: string;
  name: string;
  role: string;
  gender: "m" | "f";
}

/** One row of the leaderboard. Computed server-side across every theme. */
export interface Standing {
  /** `users._id` of the guesser. */
  id: string;
  name: string;
  /** Null for a guesser who is no longer on the roster. */
  role: string | null;
  guesses: number;
  /** UTC ISO of the newest correct guess, for breaking ties on form. */
  lastGuess: string | null;
}

export const THEME_PAGE_SIZE = 20;

const objectIdHex = z
  .string()
  .regex(/^[a-f0-9]{24}$/i, "מזהה לא תקין");

export const themeInputSchema = z.object({
  theme: z
    .string()
    .trim()
    .min(1, "צריך לכתוב מה היה הנושא")
    .max(120, "הנושא ארוך מדי"),
  // The form takes a comma-separated string and splits it client-side, so here
  // it always arrives as an array. Drop empties, do not dedupe — then bound it.
  snacks: z
    .array(z.string())
    .optional()
    .default([])
    .transform((list) => list.map((snack) => snack.trim()).filter(Boolean))
    .pipe(
      z
        .array(z.string().max(60, "פריט בכיבוד ארוך מדי"))
        .max(20, "יותר מדי פריטים בכיבוד"),
    ),
  date: dateOnly,
  broughtById: objectIdHex,
  // A theme can be unsolved, so guessedById is optional and nullable.
  guessedById: objectIdHex
    .nullish()
    .transform((value) => value ?? null),
  // No `broughtBy`/`guessedBy`/`addedBy` keys: display names are resolved
  // server-side from the roster and the session, exactly as `quoteInputSchema`
  // strips `addedBy`. Anything sent under them is dropped here.
});

export type ThemeInput = z.input<typeof themeInputSchema>;
export type ThemeValues = z.output<typeof themeInputSchema>;

/**
 * Shared positions for ties — five people on one guess are all 2nd, and the
 * next one down is 7th. Pure and client-side, like the quotes helpers.
 */
export function placeOf(list: Standing[], index: number): number {
  const { guesses } = list[index];
  return list.findIndex((entry) => entry.guesses === guesses) + 1;
}
