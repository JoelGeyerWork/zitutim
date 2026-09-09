import "server-only";

import {
  ObjectId,
  type Collection,
  type Document,
  type IndexDescription,
} from "mongodb";

import {
  asReactionEmoji,
  toReactionCounts,
  type CommentValues,
  type QuoteComment,
  type ReactionEmoji,
  type ReactionState,
} from "@/lib/engagement-schema";
import { getDb } from "@/lib/mongodb";

export * from "@/lib/engagement-schema";

export interface QuoteReactionDoc {
  _id: ObjectId;
  quoteId: ObjectId;
  userId: ObjectId;
  emoji: ReactionEmoji;
  createdAt: Date;
  /** Moves when someone swaps one emoji for another; `createdAt` keeps the first. */
  updatedAt: Date;
}

export interface QuoteCommentDoc {
  _id: ObjectId;
  quoteId: ObjectId;
  authorId: ObjectId;
  text: string;
  createdAt: Date;
  updatedAt: Date;
}

interface ResolvedCommentDoc extends QuoteCommentDoc {
  authorName: string;
}

export type CommentMutationResult =
  | { status: "ok"; comment: QuoteComment }
  | { status: "not_found" }
  | { status: "forbidden" };

async function reactions(): Promise<Collection<QuoteReactionDoc>> {
  const db = await getDb();
  return db.collection<QuoteReactionDoc>("quote_reactions");
}

async function comments(): Promise<Collection<QuoteCommentDoc>> {
  const db = await getDb();
  return db.collection<QuoteCommentDoc>("quote_comments");
}

async function quoteExists(quoteId: ObjectId): Promise<boolean> {
  const db = await getDb();
  return (await db.collection("quotes").countDocuments({ _id: quoteId }, { limit: 1 })) > 0;
}

function serializeComment(doc: ResolvedCommentDoc): QuoteComment {
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

function resolveAuthorStages(): Document[] {
  return [
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
          $ifNull: [{ $first: "$author.displayName" }, "משתמש לא מוכר"],
        },
      },
    },
    { $unset: "author" },
  ];
}

async function resolvedComment(
  quoteId: ObjectId,
  commentId: ObjectId,
): Promise<QuoteComment | null> {
  const collection = await comments();
  const [doc] = await collection
    .aggregate<ResolvedCommentDoc>([
      { $match: { _id: commentId, quoteId } },
      ...resolveAuthorStages(),
    ])
    .toArray();
  return doc ? serializeComment(doc) : null;
}

/**
 * Kept callable from the memory-server setup so the same database-enforced
 * uniqueness used in production is present in tests too.
 */
export async function createEngagementIndexes(): Promise<void> {
  const reactionIndexes: IndexDescription[] = [
    // One person, one reaction per quote — the boundary a swap relies on, since
    // it is an upsert on this key rather than a delete and an insert.
    { key: { quoteId: 1, userId: 1 }, unique: true },
  ];
  const commentIndexes: IndexDescription[] = [
    { key: { quoteId: 1, createdAt: 1, _id: 1 } },
    { key: { authorId: 1 } },
  ];

  const [reactionCollection, commentCollection] = await Promise.all([
    reactions(),
    comments(),
  ]);
  await Promise.all([
    reactionCollection.createIndexes(reactionIndexes),
    commentCollection.createIndexes(commentIndexes),
  ]);
}

/**
 * Counts per emoji plus the viewer's own pick. Grouping in the database keeps
 * this one round trip whatever the palette grows to.
 */
async function readReactionState(
  quoteObjectId: ObjectId,
  viewerId: ObjectId | null,
): Promise<ReactionState> {
  const collection = await reactions();
  const [rows, viewerRow] = await Promise.all([
    collection
      .aggregate<{ emoji: string; count: number }>([
        { $match: { quoteId: quoteObjectId } },
        { $group: { _id: "$emoji", count: { $sum: 1 } } },
        { $project: { _id: 0, emoji: "$_id", count: 1 } },
      ])
      .toArray(),
    viewerId
      ? collection.findOne({ quoteId: quoteObjectId, userId: viewerId })
      : null,
  ]);

  return {
    counts: toReactionCounts(rows),
    // Narrowed rather than trusted: a row may hold an emoji the palette has
    // since dropped, and the client only knows how to draw current ones.
    viewerReaction: asReactionEmoji(viewerRow?.emoji),
  };
}

export async function getReactionState(
  quoteId: string,
  userId?: string,
): Promise<ReactionState | null> {
  if (!ObjectId.isValid(quoteId)) return null;
  const quoteObjectId = new ObjectId(quoteId);
  if (!(await quoteExists(quoteObjectId))) return null;

  const viewerId = userId && ObjectId.isValid(userId) ? new ObjectId(userId) : null;
  return readReactionState(quoteObjectId, viewerId);
}

/**
 * PUT semantics make retries idempotent: the client sends the emoji it wants to
 * end on — or null to withdraw — while the unique index remains the final
 * one-user/one-quote boundary.
 *
 * Swapping emoji is an upsert on that key rather than a delete and an insert,
 * so a second reaction can never slip into the gap between the two.
 */
export async function setQuoteReaction(
  quoteId: string,
  userId: string,
  emoji: ReactionEmoji | null,
): Promise<ReactionState | null> {
  if (!ObjectId.isValid(quoteId) || !ObjectId.isValid(userId)) return null;

  const quoteObjectId = new ObjectId(quoteId);
  const userObjectId = new ObjectId(userId);
  if (!(await quoteExists(quoteObjectId))) return null;

  const collection = await reactions();
  const filter = { quoteId: quoteObjectId, userId: userObjectId };

  if (emoji) {
    const now = new Date();
    try {
      await collection.updateOne(
        filter,
        { $set: { emoji, updatedAt: now }, $setOnInsert: { createdAt: now } },
        { upsert: true },
      );
    } catch (error) {
      if (
        !error ||
        typeof error !== "object" ||
        (error as { code?: number }).code !== 11000
      ) {
        throw error;
      }
      // Two first ratings on the same quote race at the upsert boundary and the
      // unique index picks one winner. The like this replaced could stop here:
      // both racers only wanted "a row exists", so the winner's insert met the
      // loser's intent too. An emoji is carried in the $set, so it does not —
      // swallowing this would drop a write the caller was about to be told had
      // been applied, and hand it back the other person's pick. Retry as a
      // plain update against the row that now exists; last write wins, which is
      // what a desired-state PUT promises.
      await collection.updateOne(filter, { $set: { emoji, updatedAt: now } });
    }
  } else {
    await collection.deleteOne(filter);
  }

  // Quote deletion cannot share a transaction with this on standalone Mongo.
  // Rechecking closes the only orphan window: either deletion's cleanup sees
  // this row, or this writer notices the missing quote and removes it itself.
  if (!(await quoteExists(quoteObjectId))) {
    await collection.deleteOne(filter);
    return null;
  }

  return readReactionState(quoteObjectId, userObjectId);
}

export async function listComments(
  quoteId: string,
): Promise<QuoteComment[] | null> {
  if (!ObjectId.isValid(quoteId)) return null;
  const quoteObjectId = new ObjectId(quoteId);
  if (!(await quoteExists(quoteObjectId))) return null;

  const collection = await comments();
  const docs = await collection
    .aggregate<ResolvedCommentDoc>([
      { $match: { quoteId: quoteObjectId } },
      // Oldest first is the natural reading order; `_id` makes ties total.
      { $sort: { createdAt: 1, _id: 1 } },
      ...resolveAuthorStages(),
    ])
    .toArray();
  return docs.map(serializeComment);
}

export async function createComment(
  quoteId: string,
  input: CommentValues,
  authorId: string,
): Promise<QuoteComment | null> {
  if (!ObjectId.isValid(quoteId) || !ObjectId.isValid(authorId)) return null;
  const quoteObjectId = new ObjectId(quoteId);
  if (!(await quoteExists(quoteObjectId))) return null;

  const collection = await comments();
  const now = new Date();
  const doc: Omit<QuoteCommentDoc, "_id"> = {
    quoteId: quoteObjectId,
    authorId: new ObjectId(authorId),
    text: input.text,
    createdAt: now,
    updatedAt: now,
  };
  const result = await collection.insertOne(doc as QuoteCommentDoc);

  // See the reaction write above: this pairs with quote deletion's cleanup so a
  // concurrent delete cannot strand a newly inserted comment.
  if (!(await quoteExists(quoteObjectId))) {
    await collection.deleteOne({ _id: result.insertedId });
    return null;
  }

  return resolvedComment(quoteObjectId, result.insertedId);
}

export async function updateComment(
  quoteId: string,
  commentId: string,
  input: CommentValues,
  actorId: string,
): Promise<CommentMutationResult> {
  if (
    !ObjectId.isValid(quoteId) ||
    !ObjectId.isValid(commentId) ||
    !ObjectId.isValid(actorId)
  ) {
    return { status: "not_found" };
  }

  const quoteObjectId = new ObjectId(quoteId);
  const commentObjectId = new ObjectId(commentId);
  if (!(await quoteExists(quoteObjectId))) return { status: "not_found" };

  const collection = await comments();
  const existing = await collection.findOne({
    _id: commentObjectId,
    quoteId: quoteObjectId,
  });

  if (!existing) return { status: "not_found" };
  if (!existing.authorId.equals(actorId)) {
    return (await quoteExists(quoteObjectId))
      ? { status: "forbidden" }
      : { status: "not_found" };
  }

  const updated = await collection.findOneAndUpdate(
    {
      _id: commentObjectId,
      quoteId: quoteObjectId,
      authorId: new ObjectId(actorId),
    },
    { $set: { text: input.text, updatedAt: new Date() } },
  );
  if (!updated) return { status: "not_found" };

  // As with creation, quote deletion can land between the first existence
  // check and this write. Never report success for an orphan, and clean up if
  // the quote deletion's non-transactional engagement cleanup missed it.
  if (!(await quoteExists(quoteObjectId))) {
    await collection.deleteOne({
      _id: commentObjectId,
      quoteId: quoteObjectId,
    });
    return { status: "not_found" };
  }

  const comment = await resolvedComment(quoteObjectId, commentObjectId);
  return comment ? { status: "ok", comment } : { status: "not_found" };
}

export async function deleteComment(
  quoteId: string,
  commentId: string,
  actorId: string,
): Promise<Exclude<CommentMutationResult, { status: "ok" }> | { status: "ok" }> {
  if (
    !ObjectId.isValid(quoteId) ||
    !ObjectId.isValid(commentId) ||
    !ObjectId.isValid(actorId)
  ) {
    return { status: "not_found" };
  }

  const quoteObjectId = new ObjectId(quoteId);
  if (!(await quoteExists(quoteObjectId))) return { status: "not_found" };

  const collection = await comments();
  const filter = {
    _id: new ObjectId(commentId),
    quoteId: quoteObjectId,
  };
  const existing = await collection.findOne(filter);
  if (!existing) return { status: "not_found" };
  if (!existing.authorId.equals(actorId)) {
    return (await quoteExists(quoteObjectId))
      ? { status: "forbidden" }
      : { status: "not_found" };
  }

  const result = await collection.deleteOne({
    ...filter,
    authorId: new ObjectId(actorId),
  });
  if (result.deletedCount !== 1 || !(await quoteExists(quoteObjectId))) {
    return { status: "not_found" };
  }
  return { status: "ok" };
}

/**
 * Called even when the quote row was already absent. If cleanup fails after
 * the quote delete, retrying the same DELETE can therefore finish the work.
 */
export async function deleteQuoteEngagement(quoteId: ObjectId): Promise<void> {
  const [reactionCollection, commentCollection] = await Promise.all([
    reactions(),
    comments(),
  ]);
  await Promise.all([
    reactionCollection.deleteMany({ quoteId }),
    commentCollection.deleteMany({ quoteId }),
  ]);
}
