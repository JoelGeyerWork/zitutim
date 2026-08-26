import "server-only";

import {
  ObjectId,
  type Collection,
  type Document,
  type Filter,
} from "mongodb";

import { deleteQuoteEngagement } from "@/lib/engagement";
import type { QuoteComment } from "@/lib/engagement-schema";
import { getDb } from "@/lib/mongodb";
import {
  PAGE_SIZE,
  QUOTE_GAME_LENGTH,
  QUOTE_GAME_OPTION_COUNT,
  type Quote,
  type QuoteGameRound,
  type QuotePage,
  type QuoteValues,
  type SortOption,
} from "@/lib/quote-schema";

export * from "@/lib/quote-schema";

/** Whoever is making the change, taken from the session — never from the body. */
export interface QuoteActor {
  /** `users._id` as a hex string. */
  id: string;
  /** AD display name, snapshotted onto the document. */
  name: string;
}

/** Shape stored in MongoDB. */
export interface QuoteDoc {
  _id: ObjectId;
  text: string;
  author: string;
  /** When the quote was said. Stored as a UTC date at midnight. */
  saidAt: Date;
  /** Optional colour: where it happened, what prompted it. */
  context: string | null;
  /**
   * Display name of whoever added the quote, snapshotted at create time.
   *
   * Denormalized on purpose: it is rendered directly, and it is one of the four
   * fields `listQuotes` regex-searches. Resolving it through `addedById`
   * instead would need a $lookup and the whole search design falls apart. It is
   * also the more historically accurate record — the name the adder had then.
   */
  addedBy: string | null;
  /** Null on the documents that predate authentication; the key may be absent entirely. */
  addedById: ObjectId | null;
  /** Any signed-in user may edit any quote, so record who last did. */
  updatedBy: string | null;
  updatedById: ObjectId | null;
  createdAt: Date;
  updatedAt: Date;
}

interface QuoteCommentAggregateDoc {
  _id: ObjectId;
  quoteId: ObjectId;
  authorId: ObjectId;
  authorName: string;
  text: string;
  createdAt: Date;
  updatedAt: Date;
}

interface QuoteAggregateDoc extends QuoteDoc {
  likeCount: number;
  commentCount: number;
  likedByViewer: boolean;
  commentsPreview: QuoteCommentAggregateDoc[];
}

function serializeComment(doc: QuoteCommentAggregateDoc): QuoteComment {
  return {
    id: doc._id.toHexString(),
    quoteId: doc.quoteId.toHexString(),
    authorId: doc.authorId.toHexString(),
    authorName: doc.authorName,
    text: doc.text,
    createdAt: doc.createdAt.toISOString(),
    updatedAt: doc.updatedAt.toISOString(),
  };
}

function serialize(doc: QuoteDoc | QuoteAggregateDoc): Quote {
  const engagement =
    "likeCount" in doc
      ? doc
      : {
          likeCount: 0,
          commentCount: 0,
          likedByViewer: false,
          commentsPreview: [],
        };

  return {
    id: doc._id.toHexString(),
    text: doc.text,
    author: doc.author,
    saidAt: doc.saidAt.toISOString(),
    context: doc.context,
    addedBy: doc.addedBy,
    // Pre-auth documents lack these keys entirely, so never assume presence.
    addedById: doc.addedById?.toHexString() ?? null,
    updatedBy: doc.updatedBy ?? null,
    updatedById: doc.updatedById?.toHexString() ?? null,
    createdAt: doc.createdAt.toISOString(),
    updatedAt: doc.updatedAt.toISOString(),
    likeCount: engagement.likeCount,
    commentCount: engagement.commentCount,
    likedByViewer: engagement.likedByViewer,
    commentsPreview: engagement.commentsPreview.map(serializeComment),
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

function shuffled<T>(values: readonly T[]): T[] {
  const result = [...values];
  for (let index = result.length - 1; index > 0; index--) {
    const swapWith = Math.floor(Math.random() * (index + 1));
    [result[index], result[swapWith]] = [result[swapWith], result[index]];
  }
  return result;
}

/**
 * Resolve counts, the current viewer's like and the latest-two preview in the
 * same aggregate that loads the quote page. Each lookup is index-backed and
 * avoids a query per card.
 */
function engagementStages(viewerId?: string): Document[] {
  const viewer =
    viewerId && ObjectId.isValid(viewerId) ? new ObjectId(viewerId) : null;

  return [
    {
      $lookup: {
        from: "quote_likes",
        let: { currentQuoteId: "$_id" },
        pipeline: [
          {
            $match: {
              $expr: { $eq: ["$quoteId", "$$currentQuoteId"] },
            },
          },
          {
            $group: {
              _id: null,
              count: { $sum: 1 },
              viewerLiked: {
                $max: viewer
                  ? { $cond: [{ $eq: ["$userId", viewer] }, 1, 0] }
                  : 0,
              },
            },
          },
        ],
        as: "likeSummary",
      },
    },
    {
      $lookup: {
        from: "quote_comments",
        let: { currentQuoteId: "$_id" },
        pipeline: [
          {
            $match: {
              $expr: { $eq: ["$quoteId", "$$currentQuoteId"] },
            },
          },
          {
            $facet: {
              total: [{ $count: "value" }],
              preview: [
                // Fetch newest first so the limit selects the latest two, then
                // reverse below so those two still read chronologically.
                { $sort: { createdAt: -1, _id: -1 } },
                { $limit: 2 },
                {
                  $lookup: {
                    from: "users",
                    localField: "authorId",
                    foreignField: "_id",
                    as: "author",
                  },
                },
                {
                  $set: {
                    authorName: {
                      $ifNull: [
                        { $first: "$author.displayName" },
                        "משתמש לא מוכר",
                      ],
                    },
                  },
                },
                {
                  $project: {
                    author: 0,
                  },
                },
              ],
            },
          },
          {
            $project: {
              count: { $ifNull: [{ $first: "$total.value" }, 0] },
              preview: { $reverseArray: "$preview" },
            },
          },
        ],
        as: "commentSummary",
      },
    },
    {
      $set: {
        likeCount: { $ifNull: [{ $first: "$likeSummary.count" }, 0] },
        likedByViewer: {
          $eq: [{ $ifNull: [{ $first: "$likeSummary.viewerLiked" }, 0] }, 1],
        },
        commentCount: {
          $ifNull: [{ $first: "$commentSummary.count" }, 0],
        },
        commentsPreview: {
          $ifNull: [{ $first: "$commentSummary.preview" }, []],
        },
      },
    },
    { $unset: ["likeSummary", "commentSummary"] },
  ];
}

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
  viewerId,
}: {
  search?: string;
  sort?: SortOption;
  skip?: number;
  limit?: number;
  viewerId?: string;
} = {}): Promise<QuotePage> {
  const collection = await quotes();
  const filter: Filter<QuoteDoc> = {};

  const term = search?.trim();
  if (term) {
    const pattern = new RegExp(escapeRegex(term), "i");
    // `addedBy` is matched as stored text — this is the reason it stays
    // denormalized rather than being resolved through `addedById`.
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
      .aggregate<QuoteAggregateDoc>([
        { $match: filter },
        { $sort: sortSpecs[sort] ?? sortSpecs.added },
        { $skip: safeSkip },
        { $limit: safeLimit },
        ...engagementStages(viewerId),
      ])
      .toArray(),
    collection.countDocuments(filter),
  ]);

  return {
    quotes: docs.map(serialize),
    total,
    hasMore: safeSkip + docs.length < total,
  };
}

export async function getQuote(
  id: string,
  viewerId?: string,
): Promise<Quote | null> {
  if (!ObjectId.isValid(id)) return null;
  const collection = await quotes();
  const [doc] = await collection
    .aggregate<QuoteAggregateDoc>([
      { $match: { _id: new ObjectId(id) } },
      ...engagementStages(viewerId),
    ])
    .toArray();
  return doc ? serialize(doc) : null;
}

/**
 * Build the questions on the server so the first random order is also the one
 * hydrated by the browser. The answer is sent to the client because this is a
 * casual team game, not a security boundary or a persisted competition.
 */
export async function getQuoteGame(
  roundCount = QUOTE_GAME_LENGTH,
): Promise<QuoteGameRound[]> {
  const collection = await quotes();
  const authors = (await collection.distinct("author")).filter(
    (author) => author.trim().length > 0,
  );

  if (authors.length < 2) return [];

  const safeRoundCount = Math.min(
    Math.max(1, Math.floor(roundCount) || QUOTE_GAME_LENGTH),
    50,
  );
  const sampled = await collection
    .aggregate<
      Pick<QuoteDoc, "_id" | "text" | "author" | "saidAt" | "context">
    >([
      { $sample: { size: safeRoundCount } },
      {
        $project: {
          text: 1,
          author: 1,
          saidAt: 1,
          context: 1,
        },
      },
    ])
    .toArray();

  return sampled.map((quote) => {
    const distractors = shuffled(
      authors.filter((author) => author !== quote.author),
    ).slice(0, QUOTE_GAME_OPTION_COUNT - 1);

    return {
      id: quote._id.toHexString(),
      text: quote.text,
      saidAt: quote.saidAt.toISOString(),
      context: quote.context,
      correctAuthor: quote.author,
      options: shuffled([quote.author, ...distractors]),
    };
  });
}

/**
 * `actor` is required rather than optional: an optional one lets a forgotten
 * call site silently create an unattributed quote, where a required one makes
 * the compiler walk you to every caller.
 */
export async function createQuote(
  input: QuoteValues,
  actor: QuoteActor,
): Promise<Quote> {
  const collection = await quotes();
  const now = new Date();
  const doc: Omit<QuoteDoc, "_id"> = {
    text: input.text,
    author: input.author,
    saidAt: new Date(input.saidAt),
    context: input.context,
    addedBy: actor.name,
    addedById: new ObjectId(actor.id),
    updatedBy: null,
    updatedById: null,
    createdAt: now,
    updatedAt: now,
  };

  const result = await collection.insertOne(doc as QuoteDoc);
  return serialize({ ...doc, _id: result.insertedId });
}

/**
 * Note what is *not* in the `$set`: `addedBy` and `addedById` are never
 * rewritten. Any signed-in user may edit any quote, so stamping the editor here
 * would silently transfer authorship to whoever last touched it. The edit is
 * recorded in `updatedBy` instead.
 */
export async function updateQuote(
  id: string,
  input: QuoteValues,
  actor: QuoteActor,
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
        updatedBy: actor.name,
        updatedById: new ObjectId(actor.id),
        updatedAt: new Date(),
      },
    },
    { returnDocument: "after" },
  );

  return doc ? getQuote(id, actor.id) : null;
}

export async function deleteQuote(id: string): Promise<boolean> {
  if (!ObjectId.isValid(id)) return false;
  const collection = await quotes();
  const quoteId = new ObjectId(id);
  const result = await collection.deleteOne({ _id: quoteId });
  // Standalone Mongo (including the memory-server suite) cannot provide a
  // transaction here. Cleanup still runs when the quote was already absent,
  // so a retry can finish after a partial infrastructure failure.
  await deleteQuoteEngagement(quoteId);
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
