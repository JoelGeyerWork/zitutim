import "server-only";

import { ObjectId, type Collection, type Filter } from "mongodb";

import { getDb } from "@/lib/mongodb";
import {
  PAGE_SIZE,
  type Quote,
  type QuotePage,
  type QuoteValues,
  type SortOption,
} from "@/lib/quote-schema";

export * from "@/lib/quote-schema";

/** Shape stored in MongoDB. */
export interface QuoteDoc {
  _id: ObjectId;
  text: string;
  author: string;
  /** When the quote was said. Stored as a UTC date at midnight. */
  saidAt: Date;
  /** Optional colour: where it happened, what prompted it. */
  context: string | null;
  /** Optional: whoever added the quote to the wall. */
  addedBy: string | null;
  createdAt: Date;
  updatedAt: Date;
}

function serialize(doc: QuoteDoc): Quote {
  return {
    id: doc._id.toHexString(),
    text: doc.text,
    author: doc.author,
    saidAt: doc.saidAt.toISOString(),
    context: doc.context,
    addedBy: doc.addedBy,
    createdAt: doc.createdAt.toISOString(),
    updatedAt: doc.updatedAt.toISOString(),
  };
}

async function quotes(): Promise<Collection<QuoteDoc>> {
  const db = await getDb();
  return db.collection<QuoteDoc>("quotes");
}

/** Escape a user string so it can go inside a RegExp literally. */
function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Every spec ends in `_id` so the ordering is total. Without it, quotes that
 * tie (same day, or added in the same millisecond) come back in an arbitrary
 * order, and offset pagination would then show one twice or skip it entirely.
 */
const sortSpecs: Record<SortOption, Record<string, 1 | -1>> = {
  added: { createdAt: -1, _id: -1 },
  recent: { saidAt: -1, createdAt: -1, _id: -1 },
  oldest: { saidAt: 1, createdAt: 1, _id: 1 },
  author: { author: 1, saidAt: -1, _id: -1 },
};

/**
 * Offset pagination rather than a cursor: a team quote wall is small enough
 * that the skip cost never matters, and it keeps "load more" trivial on both
 * the feed and the search page.
 */
export async function listQuotes({
  search,
  sort = "added",
  skip = 0,
  limit = PAGE_SIZE,
}: {
  search?: string;
  sort?: SortOption;
  skip?: number;
  limit?: number;
} = {}): Promise<QuotePage> {
  const collection = await quotes();
  const filter: Filter<QuoteDoc> = {};

  const term = search?.trim();
  if (term) {
    const pattern = new RegExp(escapeRegex(term), "i");
    filter.$or = [
      { text: pattern },
      { author: pattern },
      { context: pattern },
      { addedBy: pattern },
    ];
  }

  const safeSkip = Math.max(0, Math.floor(skip) || 0);
  const safeLimit = Math.min(Math.max(1, Math.floor(limit) || PAGE_SIZE), 100);

  const [docs, total] = await Promise.all([
    collection
      .find(filter)
      .sort(sortSpecs[sort] ?? sortSpecs.added)
      .skip(safeSkip)
      .limit(safeLimit)
      .toArray(),
    collection.countDocuments(filter),
  ]);

  return {
    quotes: docs.map(serialize),
    total,
    hasMore: safeSkip + docs.length < total,
  };
}

export async function getQuote(id: string): Promise<Quote | null> {
  if (!ObjectId.isValid(id)) return null;
  const collection = await quotes();
  const doc = await collection.findOne({ _id: new ObjectId(id) });
  return doc ? serialize(doc) : null;
}

export async function createQuote(input: QuoteValues): Promise<Quote> {
  const collection = await quotes();
  const now = new Date();
  const doc: Omit<QuoteDoc, "_id"> = {
    text: input.text,
    author: input.author,
    saidAt: new Date(input.saidAt),
    context: input.context,
    addedBy: input.addedBy,
    createdAt: now,
    updatedAt: now,
  };

  const result = await collection.insertOne(doc as QuoteDoc);
  return serialize({ ...doc, _id: result.insertedId });
}

export async function updateQuote(
  id: string,
  input: QuoteValues,
): Promise<Quote | null> {
  if (!ObjectId.isValid(id)) return null;
  const collection = await quotes();

  const doc = await collection.findOneAndUpdate(
    { _id: new ObjectId(id) },
    {
      $set: {
        text: input.text,
        author: input.author,
        saidAt: new Date(input.saidAt),
        context: input.context,
        addedBy: input.addedBy,
        updatedAt: new Date(),
      },
    },
    { returnDocument: "after" },
  );

  return doc ? serialize(doc) : null;
}

export async function deleteQuote(id: string): Promise<boolean> {
  if (!ObjectId.isValid(id)) return false;
  const collection = await quotes();
  const result = await collection.deleteOne({ _id: new ObjectId(id) });
  return result.deletedCount === 1;
}

export interface QuoteStats {
  total: number;
  authors: number;
  topAuthor: { author: string; count: number } | null;
}

export async function getStats(): Promise<QuoteStats> {
  const collection = await quotes();
  const [total, byAuthor] = await Promise.all([
    collection.countDocuments(),
    collection
      .aggregate<{ _id: string; count: number }>([
        { $group: { _id: "$author", count: { $sum: 1 } } },
        { $sort: { count: -1, _id: 1 } },
      ])
      .toArray(),
  ]);

  return {
    total,
    authors: byAuthor.length,
    topAuthor: byAuthor[0]
      ? { author: byAuthor[0]._id, count: byAuthor[0].count }
      : null,
  };
}
