import "server-only";

import { ObjectId, type Collection } from "mongodb";

import { getDb } from "@/lib/mongodb";
import {
  type ReviewInput,
  type ShotefReview,
  type ShotefReviewList,
} from "@/lib/shotef-schema";
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

/**
 * The person a summary is *about*, resolved out of `users` before it is stored.
 *
 * Deliberately not a snapshot on the document: the name is looked up again on
 * every read (see `listShotefReviews`), so a week keeps its author after they
 * leave the on-call rotation and a rename in AD reaches every past week at
 * once. This shape only exists so the write path can answer "who was that?"
 * once — for the route's 422 and for the record it hands back — instead of
 * twice.
 */
export interface ReviewMember {
  /** `users._id` as a hex string. */
  id: string;
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

/** A stored review with the name the `$lookup` below resolved for it. */
type JoinedReviewDoc = ShotefReviewDoc & { memberName?: string | null };

function serialize(doc: JoinedReviewDoc): ShotefReview {
  return {
    id: doc._id.toHexString(),
    weekStart: doc.weekStart.toISOString(),
    memberId: doc.memberId.toHexString(),
    // Empty rather than a placeholder: `users` rows are never deleted, so a
    // miss here means the row is genuinely gone, and naming the hole is the
    // view's job, not the data layer's.
    memberName: doc.memberName ?? "",
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

/**
 * Every summary, newest week first, each with its shotef's *current* name.
 * Deliberately unpaginated — see the route.
 *
 * The name is joined here rather than snapshotted on the document, and it is
 * joined against `users` rather than looked up in the on-call rotation. Both
 * halves matter: a review is a record of a week that happened, so leaving the
 * rotation must not blank out its author, and `users` rows are never deleted,
 * so the name is always there to resolve. `quote_comments` is the precedent.
 */
export async function listShotefReviews(): Promise<ShotefReview[]> {
  const docs = await (await reviews())
    .aggregate<JoinedReviewDoc>([
      { $sort: SORT },
      {
        $lookup: {
          from: "users",
          localField: "memberId",
          foreignField: "_id",
          as: "member",
        },
      },
      // A `users._id` is unique, so the join is one row or none — flattened
      // here so nothing downstream has to know it arrived as an array.
      { $set: { memberName: { $arrayElemAt: ["$member.displayName", 0] } } },
      { $unset: "member" },
    ])
    .toArray();

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
 * The `users` row `memberId` names, or null when it names nobody.
 *
 * `reviewInputSchema` only knows the field is a non-empty string, so an id that
 * resolves to no one is invalid *input* — the route turns a null here into a
 * 422 on that field rather than letting the insert succeed against a member who
 * does not exist. It comes back with the name attached because the created
 * record has to carry one, and asking twice for the same row would be silly.
 */
/**
 * One week, one summary — declared here, not only in `scripts/seed.mjs`.
 *
 * `createShotefReview` has no pre-check `findOne` on purpose: two people
 * writing up the same week would race it. The whole guarantee is therefore the
 * unique index, and a database that never had the seed run by hand would have
 * silently accepted both. Kept callable from the memory-server setup so the
 * tests exercise the same database-enforced uniqueness production relies on,
 * the way `createEngagementIndexes` already does.
 */
export async function createShotefReviewIndexes(): Promise<void> {
  const collection = await reviews();
  await collection.createIndexes([{ key: { weekStart: -1 }, unique: true }]);
}

export async function findReviewMember(
  memberId: string,
): Promise<ReviewMember | null> {
  if (!ObjectId.isValid(memberId)) return null;
  const db = await getDb();
  const row = await db
    .collection<UserDoc>("users")
    .findOne(
      { _id: new ObjectId(memberId) },
      { projection: { _id: 1, displayName: 1 } },
    );
  if (!row) return null;
  return { id: row._id.toHexString(), name: row.displayName };
}

/**
 * `member` is the row `findReviewMember` already resolved, not `input.memberId`
 * — so this cannot store an FK that points at nobody, and the record it hands
 * back can carry the name without a second read.
 */
export async function createShotefReview(
  input: ReviewInput,
  member: ReviewMember,
  actor: ReviewActor,
): Promise<ShotefReview> {
  const collection = await reviews();
  const doc: Omit<ShotefReviewDoc, "_id"> = {
    // "2026-08-16" parses as UTC midnight, which is exactly how it is stored.
    weekStart: new Date(input.weekStart),
    memberId: new ObjectId(member.id),
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
  return serialize({ ...doc, _id: result.insertedId, memberName: member.name });
}
