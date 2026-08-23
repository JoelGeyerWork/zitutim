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

export interface LikeState {
  likeCount: number;
  likedByViewer: boolean;
}

export const commentInputSchema = z.object({
  text: z
    .string()
    .trim()
    .min(1, "צריך לכתוב תגובה")
    .max(COMMENT_MAX_LENGTH, "התגובה ארוכה מדי"),
});

export const likeInputSchema = z.object({
  liked: z.boolean("צריך לציין אם לסמן לייק"),
});

export type CommentInput = z.input<typeof commentInputSchema>;
export type CommentValues = z.output<typeof commentInputSchema>;
export type LikeValues = z.output<typeof likeInputSchema>;
