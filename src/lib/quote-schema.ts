import { z } from "zod";

/**
 * Types, constants and validation shared by the server and the browser.
 * Deliberately free of any `mongodb` import so client components can use it.
 */

/** Shape sent to the client — ObjectId and Dates flattened to strings. */
export interface Quote {
  id: string;
  text: string;
  author: string;
  saidAt: string;
  context: string | null;
  addedBy: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface QuotePage {
  quotes: Quote[];
  total: number;
  hasMore: boolean;
}

export const PAGE_SIZE = 15;

export const SORT_OPTIONS = ["added", "recent", "oldest", "author"] as const;
export type SortOption = (typeof SORT_OPTIONS)[number];

export const SORT_LABELS: Record<SortOption, string> = {
  added: "לפי סדר ההוספה",
  recent: "מהחדש לישן",
  oldest: "מהישן לחדש",
  author: "לפי שם הדובר",
};

/**
 * A YYYY-MM-DD date, parsed as UTC midnight so the day never shifts with the
 * server's timezone. `new Date("2026-08-08")` already does this; the explicit
 * regex just keeps other formats from sneaking through.
 */
const dateOnly = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "צריך תאריך תקין")
  .refine((value) => {
    // Date.parse happily rolls "2026-02-31" over to March 3rd, so compare the
    // round-trip against the input to reject days that never existed.
    const parsed = new Date(value);
    return (
      !Number.isNaN(parsed.getTime()) &&
      parsed.toISOString().slice(0, 10) === value
    );
  }, "התאריך לא קיים")
  .refine(
    (value) => new Date(value).getTime() <= Date.now() + 24 * 60 * 60 * 1000,
    "התאריך בעתיד",
  );

const optionalText = (max: number, tooLong: string) =>
  z
    .string()
    .trim()
    .max(max, tooLong)
    .transform((value) => (value.length > 0 ? value : null))
    .nullish()
    .transform((value) => value ?? null);

export const quoteInputSchema = z.object({
  text: z
    .string()
    .trim()
    .min(1, "צריך לכתוב מה נאמר")
    .max(2000, "הציטוט ארוך מדי"),
  author: z
    .string()
    .trim()
    .min(1, "צריך לציין מי אמר")
    .max(120, "השם ארוך מדי"),
  saidAt: dateOnly,
  context: optionalText(400, "ההקשר ארוך מדי"),
  addedBy: optionalText(120, "השם ארוך מדי"),
});

export type QuoteInput = z.input<typeof quoteInputSchema>;
export type QuoteValues = z.output<typeof quoteInputSchema>;
