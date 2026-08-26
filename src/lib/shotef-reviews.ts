import "server-only";

import { ObjectId, type Collection } from "mongodb";

import { getDb } from "@/lib/mongodb";
import { type ReviewInput, type ShotefReview } from "@/lib/shotef-schema";
import { type UserDoc } from "@/lib/users";

export * from "@/lib/shotef-schema";

/**
 * סיכומי שבוע — the weekly report card, as a collection.
 *
 * The `server-only` half of the reviews tab, split from `shotef-schema.ts`
 * exactly like `quotes.ts` / `quote-schema.ts`: the types, the Zod schema and
 * the pure date maths stay client-safe over there and are re-exported from here
 * so server code needs one import.
 */

/** Whoever typed the summary in, from the session — never from the body. */
export interface ReviewActor {
  /** `users._id` as a hex string. */
  id: string;
  /** AD display name, snapshotted onto `addedBy`. */
  name: string;
}

/** Shape stored in MongoDB. */
export interface ShotefReviewDoc {
  _id: ObjectId;
  /**
   * UTC midnight of the Sunday that opened the week under review. Unique — a
   * week gets exactly one summary. Stored as a `Date` at UTC midnight because
   * it is rendered by the UTC formatters in `format.ts`; building it from local
   * parts shifts the day backwards west of Greenwich.
   */
  weekStart: Date;
  /**
   * The shotef whose week this was — a real FK into `users`, the same `_id` the
   * rotation and the themes point at. Not the slug the fixtures used.
   */
  memberId: ObjectId;
  /** 0–5 whole stars. Zero is a real score, not an absent one. */
  rating: number;
  headline: string;
  body: string;
  /**
   * Who *typed the summary in* — a different fact from whose week it was, which
   * is `memberId`. The form does not ask for an author (the summary is written
   * by the week's shotef), but a swap or a late write-up means the two can
   * differ, so the session is recorded rather than assumed. Display-name
   * snapshot plus the real reference, exactly like a quote's `addedBy`.
   */
  addedBy: string | null;
  addedById: ObjectId | null;
  createdAt: Date;
}

/** What the page reads: the list plus the aggregate that heads it. */
export interface ShotefReviewList {
  reviews: ShotefReview[];
  total: number;
  /** Mean stars across **every** review, to one decimal. Zero when there are none. */
  average: number;
}

function serialize(doc: ShotefReviewDoc): ShotefReview {
  return {
    id: doc._id.toHexString(),
    weekStart: doc.weekStart.toISOString(),
    memberId: doc.memberId.toHexString(),
    rating: doc.rating,
    headline: doc.headline,
    body: doc.body,
  };
}

async function reviews(): Promise<Collection<ShotefReviewDoc>> {
  const db = await getDb();
  return db.collection<ShotefReviewDoc>("shotef_reviews");
}

/**
 * Newest week first, and ending in `_id` like every other sort here — two rows
 * can only tie on `weekStart` while the unique index is missing, and an order
 * that is total anyway is one less thing to be surprised by.
 */
const SORT: Record<string, 1 | -1> = { weekStart: -1, _id: -1 };

/** Every summary, newest week first. Deliberately unpaginated — see the route. */
export async function listShotefReviews(): Promise<ShotefReview[]> {
  const docs = await (await reviews()).find({}).sort(SORT).toArray();
  return docs.map(serialize);
}

interface RatingGroup {
  _id: null;
  total: number;
  average: number;
}

/**
 * The average across **every** review, computed in the database.
 *
 * `averageRating` in the schema module reduces over an array and stays there:
 * the add dialog needs the number to move the moment a summary is added
 * locally, before any refetch. But it is not what the page's headline number is
 * read from, for the reason `getStandings` aggregates rather than reducing the
 * loaded page — the day this list grows a `limit`, an in-memory mean silently
 * becomes the mean of whatever the client happens to hold, and nothing about it
 * looks wrong. Rounded the same way `averageRating` rounds, so the optimistic
 * number and the stored one agree to the digit that is rendered.
 */
export async function getReviewStats(): Promise<{
  total: number;
  average: number;
}> {
  const group = await (await reviews())
    .aggregate<RatingGroup>([
      { $group: { _id: null, total: { $sum: 1 }, average: { $avg: "$rating" } } },
    ])
    .toArray();

  const row = group[0];
  if (!row || row.total === 0) return { total: 0, average: 0 };
  return { total: row.total, average: Math.round(row.average * 10) / 10 };
}

/** Everything the reviews page renders, in the fewest round trips. */
export async function getShotefReviews(): Promise<ShotefReviewList> {
  const [list, stats] = await Promise.all([
    listShotefReviews(),
    getReviewStats(),
  ]);
  return { reviews: list, total: stats.total, average: stats.average };
}

/**
 * Whether `memberId` names a real `users` row. `reviewInputSchema` only knows
 * the field is a non-empty string, so an id that resolves to nobody is invalid
 * *input* — the route turns this into a 422 on that field rather than letting
 * the insert succeed against a member who does not exist.
 */
export async function reviewMemberExists(memberId: string): Promise<boolean> {
  if (!ObjectId.isValid(memberId)) return false;
  const db = await getDb();
  const row = await db
    .collection<UserDoc>("users")
    .findOne({ _id: new ObjectId(memberId) }, { projection: { _id: 1 } });
  return row !== null;
}

export async function createShotefReview(
  input: ReviewInput,
  actor: ReviewActor,
): Promise<ShotefReview> {
  const collection = await reviews();
  const doc: Omit<ShotefReviewDoc, "_id"> = {
    // "2026-08-16" parses as UTC midnight, which is exactly how it is stored.
    weekStart: new Date(input.weekStart),
    memberId: new ObjectId(input.memberId),
    rating: input.rating,
    headline: input.headline,
    body: input.body,
    addedBy: actor.name,
    addedById: new ObjectId(actor.id),
    createdAt: new Date(),
  };

  // One week, one summary: a duplicate `weekStart` throws 11000 against the
  // unique index and the route turns that into a 409. Deliberately no
  // pre-check `findOne`, which races two people writing up the same week — and
  // the picker dropping already-reviewed weeks is a courtesy, not enforcement.
  const result = await collection.insertOne(doc as ShotefReviewDoc);
  return serialize({ ...doc, _id: result.insertedId });
}
