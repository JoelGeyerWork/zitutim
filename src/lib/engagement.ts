import "server-only";

import {
  ObjectId,
  type Collection,
  type Document,
  type IndexDescription,
} from "mongodb";

import {
  type CommentValues,
  type LikeState,
  type QuoteComment,
} from "@/lib/engagement-schema";
import { getDb } from "@/lib/mongodb";

export * from "@/lib/engagement-schema";

export interface QuoteLikeDoc {
  _id: ObjectId;
  quoteId: ObjectId;
  userId: ObjectId;
  createdAt: Date;
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

async function likes(): Promise<Collection<QuoteLikeDoc>> {
  const db = await getDb();
  return db.collection<QuoteLikeDoc>("quote_likes");
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
  const likeIndexes: IndexDescription[] = [
    { key: { quoteId: 1, userId: 1 }, unique: true },
  ];
  const commentIndexes: IndexDescription[] = [
    { key: { quoteId: 1, createdAt: 1, _id: 1 } },
    { key: { authorId: 1 } },
  ];

  const [likeCollection, commentCollection] = await Promise.all([
    likes(),
    comments(),
  ]);
  await Promise.all([
    likeCollection.createIndexes(likeIndexes),
    commentCollection.createIndexes(commentIndexes),
  ]);
}

export async function getLikeState(
  quoteId: string,
  userId?: string,
): Promise<LikeState | null> {
  if (!ObjectId.isValid(quoteId)) return null;
  const quoteObjectId = new ObjectId(quoteId);
  if (!(await quoteExists(quoteObjectId))) return null;

  const collection = await likes();
  const viewerId = userId && ObjectId.isValid(userId) ? new ObjectId(userId) : null;
  const [likeCount, viewerLike] = await Promise.all([
    collection.countDocuments({ quoteId: quoteObjectId }),
    viewerId
      ? collection.findOne({ quoteId: quoteObjectId, userId: viewerId })
      : null,
  ]);

  return { likeCount, likedByViewer: viewerLike !== null };
}

/**
 * PUT semantics make retries idempotent: the client sends the desired state,
 * while the unique index remains the final one-user/one-quote boundary.
 */
export async function setQuoteLike(
  quoteId: string,
  userId: string,
  liked: boolean,
): Promise<LikeState | null> {
  if (!ObjectId.isValid(quoteId) || !ObjectId.isValid(userId)) return null;

  const quoteObjectId = new ObjectId(quoteId);
  const userObjectId = new ObjectId(userId);
  if (!(await quoteExists(quoteObjectId))) return null;

  const collection = await likes();
  const filter = { quoteId: quoteObjectId, userId: userObjectId };

  if (liked) {
    try {
      await collection.updateOne(
        filter,
        { $setOnInsert: { createdAt: new Date() } },
        { upsert: true },
      );
    } catch (error) {
      // Concurrent first likes can race at the upsert boundary. The unique
      // index chooses one winner; once it exists, the desired state is met.
      if (
        !error ||
        typeof error !== "object" ||
        (error as { code?: number }).code !== 11000
      ) {
        throw error;
      }
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

  const likeCount = await collection.countDocuments({ quoteId: quoteObjectId });
  return { likeCount, likedByViewer: liked };
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

  // See the like write above: this pairs with quote deletion's cleanup so a
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
  const collection = await comments();
  const existing = await collection.findOne({
    _id: commentObjectId,
    quoteId: quoteObjectId,
  });

  if (!existing) return { status: "not_found" };
  if (!existing.authorId.equals(actorId)) return { status: "forbidden" };

  const updated = await collection.findOneAndUpdate(
    {
      _id: commentObjectId,
      quoteId: quoteObjectId,
      authorId: new ObjectId(actorId),
    },
    { $set: { text: input.text, updatedAt: new Date() } },
  );
  if (!updated) return { status: "not_found" };

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

  const collection = await comments();
  const filter = {
    _id: new ObjectId(commentId),
    quoteId: new ObjectId(quoteId),
  };
  const existing = await collection.findOne(filter);
  if (!existing) return { status: "not_found" };
  if (!existing.authorId.equals(actorId)) return { status: "forbidden" };

  const result = await collection.deleteOne({
    ...filter,
    authorId: new ObjectId(actorId),
  });
  return result.deletedCount === 1
    ? { status: "ok" }
    : { status: "not_found" };
}

/**
 * Called even when the quote row was already absent. If cleanup fails after
 * the quote delete, retrying the same DELETE can therefore finish the work.
 */
export async function deleteQuoteEngagement(quoteId: ObjectId): Promise<void> {
  const [likeCollection, commentCollection] = await Promise.all([
    likes(),
    comments(),
  ]);
  await Promise.all([
    likeCollection.deleteMany({ quoteId }),
    commentCollection.deleteMany({ quoteId }),
  ]);
}
