import { z } from "zod";

/**
 * Client-safe engagement types and validation. Mongo shapes stay in
 * `engagement.ts`, which is server-only.
 */

export const COMMENT_MAX_LENGTH = 1000;

export interface QuoteComment {
  id: string;
  quoteId: string;
  authorId: string;
  /** Resolved from the current `users` row, never snapshotted on the comment. */
  authorName: string;
  text: string;
  createdAt: string;
  updatedAt: string;
}

/**
 * The reaction palette, best to worst, in the order the bar draws it — so in
 * RTL 🃏 sits on the right and 🍎 on the left. It is a verdict on the quote
 * rather than a feeling about it, which is why the labels read as grades and
 * the UI calls them דירוגים, not תגובות (this app's word for a comment).
 *
 * Fixed rather than a free emoji picker on purpose: a picker is a bundle to
 * ship onto an air-gapped network, it needs server-side proof that the string
 * really is one emoji, and free choice fragments the counts across
 * near-identical glyphs. Five fit one row on a phone.
 *
 * Shrinking it is safe — `toReactionCounts` drops a stored emoji that is no
 * longer here, so a retired reaction stops being drawn without a migration.
 * That cuts both ways: an emoji taken off this list takes its tally out of the
 * UI, so retiring one people have used wants a remap, not just a deletion.
 */
export const REACTION_EMOJI = ["🃏", "♦️", "😂", "🌓", "🍎"] as const;

export type ReactionEmoji = (typeof REACTION_EMOJI)[number];

/** What each one means, for the label a screen reader reads instead of a glyph. */
export const REACTION_LABELS: Record<ReactionEmoji, string> = {
  "🃏": "אליט",
  "♦️": "טוב",
  "😂": "צחקתי קצת",
  "🌓": "בינוני",
  "🍎": "גרוע",
};

/** Only emoji somebody picked appear; a zero is an absent key, never a `0`. */
export type ReactionCounts = Partial<Record<ReactionEmoji, number>>;

export interface ReactionState {
  counts: ReactionCounts;
  /** One person, one reaction — null when the viewer is anonymous or abstained. */
  viewerReaction: ReactionEmoji | null;
}

export function isReactionEmoji(value: unknown): value is ReactionEmoji {
  return (REACTION_EMOJI as readonly unknown[]).includes(value);
}

/** Narrow a value read back out of the database, which the palette may have outgrown. */
export function asReactionEmoji(value: unknown): ReactionEmoji | null {
  return isReactionEmoji(value) ? value : null;
}

/**
 * Tally rows the database grouped by emoji. Walking the palette rather than the
 * rows is what fixes the render order and drops a retired emoji.
 */
export function toReactionCounts(
  rows: readonly { emoji?: unknown; count?: unknown }[],
): ReactionCounts {
  const counts: ReactionCounts = {};
  for (const emoji of REACTION_EMOJI) {
    const row = rows.find((candidate) => candidate.emoji === emoji);
    const count = typeof row?.count === "number" ? row.count : 0;
    if (count > 0) counts[emoji] = count;
  }
  return counts;
}

export function reactionTotal(counts: ReactionCounts): number {
  return Object.values(counts).reduce((sum, count) => sum + count, 0);
}

/**
 * Move one person's reaction between emoji, for the optimistic update the bar
 * draws before the server answers. Either end may be null: a first reaction, or
 * withdrawing one.
 */
export function applyReaction(
  counts: ReactionCounts,
  from: ReactionEmoji | null,
  to: ReactionEmoji | null,
): ReactionCounts {
  if (from === to) return counts;
  const next: ReactionCounts = { ...counts };
  if (from) {
    const remaining = (next[from] ?? 1) - 1;
    if (remaining > 0) next[from] = remaining;
    else delete next[from];
  }
  if (to) next[to] = (next[to] ?? 0) + 1;
  return next;
}

export const commentInputSchema = z.object({
  text: z
    .string()
    .trim()
    .min(1, "צריך לכתוב תגובה")
    .max(COMMENT_MAX_LENGTH, "התגובה ארוכה מדי"),
});

/**
 * `null` withdraws the viewer's reaction. Sending the desired end state rather
 * than a toggle is what keeps the PUT idempotent under a retry.
 */
export const reactionInputSchema = z.object({
  emoji: z.enum(REACTION_EMOJI, "צריך לבחור דירוג מהרשימה").nullable(),
});

export type CommentInput = z.input<typeof commentInputSchema>;
export type CommentValues = z.output<typeof commentInputSchema>;
export type ReactionValues = z.output<typeof reactionInputSchema>;
