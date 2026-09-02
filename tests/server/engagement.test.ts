import { Collection, ObjectId } from "mongodb";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  createComment,
  deleteComment,
  getLikeState,
  listComments,
  setQuoteLike,
  updateComment,
} from "@/lib/engagement";
import { getDb } from "@/lib/mongodb";
import {
  createQuote,
  deleteQuote,
  listQuotes,
  type QuoteActor,
} from "@/lib/quotes";
import type { QuoteValues } from "@/lib/quote-schema";
import { nameRef, namedAuthor } from "./factories";

const DANA: QuoteActor = {
  id: "6b0000000000000000000001",
  name: "דנה כהן",
};
const NOA: QuoteActor = {
  id: "6b0000000000000000000002",
  name: "נועה לוי",
};

const QUOTE_INPUT: QuoteValues = {
  text: "תמיד יש זמן לעוד קפה אחד",
  author: nameRef("דנה"),
  saidAt: "2026-07-28",
  context: null,
};

/** The resolved half of `QUOTE_INPUT.author` — see `nameRef`. */
const QUOTE_AUTHOR = namedAuthor("דנה");

async function insertUser(actor: QuoteActor) {
  const now = new Date("2026-08-20T09:00:00.000Z");
  const db = await getDb();
  await db.collection("users").insertOne({
    _id: new ObjectId(actor.id),
    directoryId: `directory-${actor.id}`,
    username: actor.name === DANA.name ? "dana" : "noa",
    upn: null,
    displayName: actor.name,
    title: null,
    mail: null,
    dn: "",
    createdAt: now,
    updatedAt: now,
    lastLoginAt: now,
  });
}

beforeEach(async () => {
  const db = await getDb();
  await Promise.all([
    db.collection("quotes").deleteMany({}),
    db.collection("quote_likes").deleteMany({}),
    db.collection("quote_comments").deleteMany({}),
    db.collection("users").deleteMany({}),
  ]);
  await Promise.all([insertUser(DANA), insertUser(NOA)]);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("quote likes", () => {
  it("sets a desired like state idempotently and toggles it off", async () => {
    const quote = await createQuote(QUOTE_INPUT, QUOTE_AUTHOR, DANA);

    await expect(setQuoteLike(quote.id, DANA.id, true)).resolves.toEqual({
      likeCount: 1,
      likedByViewer: true,
    });
    await expect(setQuoteLike(quote.id, DANA.id, true)).resolves.toEqual({
      likeCount: 1,
      likedByViewer: true,
    });

    const db = await getDb();
    await expect(
      db.collection("quote_likes").countDocuments(),
    ).resolves.toBe(1);

    await expect(setQuoteLike(quote.id, DANA.id, false)).resolves.toEqual({
      likeCount: 0,
      likedByViewer: false,
    });
  });

  it("keeps one database row under concurrent like requests", async () => {
    const quote = await createQuote(QUOTE_INPUT, QUOTE_AUTHOR, DANA);

    await Promise.all(
      Array.from({ length: 8 }, () =>
        setQuoteLike(quote.id, DANA.id, true),
      ),
    );

    const db = await getDb();
    await expect(
      db.collection("quote_likes").countDocuments({
        quoteId: new ObjectId(quote.id),
        userId: new ObjectId(DANA.id),
      }),
    ).resolves.toBe(1);
  });

  it("includes counts and the current viewer state in quote reads", async () => {
    const quote = await createQuote(QUOTE_INPUT, QUOTE_AUTHOR, DANA);
    await setQuoteLike(quote.id, DANA.id, true);
    await setQuoteLike(quote.id, NOA.id, true);

    const [anonymous, dana] = await Promise.all([
      listQuotes(),
      listQuotes({ viewerId: DANA.id }),
    ]);

    expect(anonymous.quotes[0]).toMatchObject({
      likeCount: 2,
      likedByViewer: false,
    });
    expect(dana.quotes[0]).toMatchObject({
      likeCount: 2,
      likedByViewer: true,
    });
    await expect(getLikeState(quote.id, NOA.id)).resolves.toEqual({
      likeCount: 2,
      likedByViewer: true,
    });
  });

  it("returns null for missing quotes", async () => {
    const missing = "0".repeat(24);
    await expect(setQuoteLike(missing, DANA.id, true)).resolves.toBeNull();
    await expect(getLikeState("bad-id", DANA.id)).resolves.toBeNull();
  });
});

describe("quote comments", () => {
  it("lists comments oldest first and resolves the current users name", async () => {
    const quote = await createQuote(QUOTE_INPUT, QUOTE_AUTHOR, DANA);
    const first = await createComment(quote.id, { text: "ראשונה" }, DANA.id);
    await createComment(quote.id, { text: "שנייה" }, NOA.id);

    const db = await getDb();
    await db.collection("users").updateOne(
      { _id: new ObjectId(DANA.id) },
      { $set: { displayName: "דנה בשם החדש" } },
    );

    const listed = await listComments(quote.id);
    expect(listed?.map((comment) => comment.text)).toEqual([
      "ראשונה",
      "שנייה",
    ]);
    expect(listed?.[0]).toMatchObject({
      id: first?.id,
      authorName: "דנה בשם החדש",
    });
  });

  it("edits and deletes only for the original author", async () => {
    const quote = await createQuote(QUOTE_INPUT, QUOTE_AUTHOR, DANA);
    const comment = await createComment(
      quote.id,
      { text: "תגובה מקורית" },
      DANA.id,
    );

    await expect(
      updateComment(quote.id, comment!.id, { text: "חטיפה" }, NOA.id),
    ).resolves.toEqual({ status: "forbidden" });
    await expect(
      deleteComment(quote.id, comment!.id, NOA.id),
    ).resolves.toEqual({ status: "forbidden" });

    const updated = await updateComment(
      quote.id,
      comment!.id,
      { text: "תגובה מתוקנת" },
      DANA.id,
    );
    expect(updated.status).toBe("ok");
    if (updated.status === "ok") {
      expect(updated.comment).toMatchObject({
        authorId: DANA.id,
        createdAt: comment!.createdAt,
        text: "תגובה מתוקנת",
      });
    }

    await expect(
      deleteComment(quote.id, comment!.id, DANA.id),
    ).resolves.toEqual({ status: "ok" });
    await expect(listComments(quote.id)).resolves.toEqual([]);
  });

  it("returns not_found for malformed and missing comment ids", async () => {
    const quote = await createQuote(QUOTE_INPUT, QUOTE_AUTHOR, DANA);
    await expect(
      updateComment(quote.id, "bad-id", { text: "טקסט" }, DANA.id),
    ).resolves.toEqual({ status: "not_found" });
    await expect(
      deleteComment(quote.id, "0".repeat(24), DANA.id),
    ).resolves.toEqual({ status: "not_found" });
    await expect(
      createComment("0".repeat(24), { text: "טקסט" }, DANA.id),
    ).resolves.toBeNull();
  });

  it("does not edit or delete orphaned comments after their quote is gone", async () => {
    const quote = await createQuote(QUOTE_INPUT, QUOTE_AUTHOR, DANA);
    const comment = await createComment(
      quote.id,
      { text: "תגובה מקורית" },
      DANA.id,
    );
    const db = await getDb();
    await db.collection("quotes").deleteOne({ _id: new ObjectId(quote.id) });

    await expect(
      updateComment(
        quote.id,
        comment!.id,
        { text: "תגובה שלא אמורה להישמר" },
        DANA.id,
      ),
    ).resolves.toEqual({ status: "not_found" });
    await expect(
      deleteComment(quote.id, comment!.id, DANA.id),
    ).resolves.toEqual({ status: "not_found" });

    await expect(
      db.collection("quote_comments").findOne({
        _id: new ObjectId(comment!.id),
      }),
    ).resolves.toMatchObject({ text: "תגובה מקורית" });
  });

  it("does not report a successful edit when the quote is deleted during the write", async () => {
    const quote = await createQuote(QUOTE_INPUT, QUOTE_AUTHOR, DANA);
    const comment = await createComment(
      quote.id,
      { text: "תגובה מקורית" },
      DANA.id,
    );
    const db = await getDb();
    const original = Collection.prototype.findOneAndUpdate;
    vi.spyOn(Collection.prototype, "findOneAndUpdate").mockImplementationOnce(
      async function (this: Collection, filter, update) {
        const result = await original.call(this, filter, update);
        await db.collection("quotes").deleteOne({
          _id: new ObjectId(quote.id),
        });
        return result;
      },
    );

    await expect(
      updateComment(
        quote.id,
        comment!.id,
        { text: "תגובה מתוקנת" },
        DANA.id,
      ),
    ).resolves.toEqual({ status: "not_found" });
    await expect(
      db.collection("quote_comments").countDocuments({
        _id: new ObjectId(comment!.id),
      }),
    ).resolves.toBe(0);
  });

  it("does not report a successful delete when the quote is deleted concurrently", async () => {
    const quote = await createQuote(QUOTE_INPUT, QUOTE_AUTHOR, DANA);
    const comment = await createComment(
      quote.id,
      { text: "תגובה מקורית" },
      DANA.id,
    );
    const db = await getDb();
    const original = Collection.prototype.deleteOne;
    vi.spyOn(Collection.prototype, "deleteOne").mockImplementationOnce(
      async function (this: Collection, filter, options) {
        const result = await original.call(this, filter, options);
        await db.collection("quotes").deleteMany({
          _id: new ObjectId(quote.id),
        });
        return result;
      },
    );

    await expect(
      deleteComment(quote.id, comment!.id, DANA.id),
    ).resolves.toEqual({ status: "not_found" });
  });

  it("previews only the latest two, in chronological order with id ties", async () => {
    const quote = await createQuote(QUOTE_INPUT, QUOTE_AUTHOR, DANA);
    const db = await getDb();
    const createdAt = new Date("2026-08-20T10:00:00.000Z");
    await db.collection("quote_comments").insertMany(
      ["ראשונה", "שנייה", "שלישית"].map((text, index) => ({
        _id: new ObjectId(`7c000000000000000000000${index + 1}`),
        quoteId: new ObjectId(quote.id),
        authorId: new ObjectId(DANA.id),
        text,
        createdAt,
        updatedAt: createdAt,
      })),
    );

    const page = await listQuotes();
    expect(page.quotes[0].commentCount).toBe(3);
    expect(
      page.quotes[0].commentsPreview.map((comment) => comment.text),
    ).toEqual(["שנייה", "שלישית"]);
  });

  it("removes likes and comments when deleting a quote", async () => {
    const quote = await createQuote(QUOTE_INPUT, QUOTE_AUTHOR, DANA);
    await setQuoteLike(quote.id, DANA.id, true);
    await createComment(quote.id, { text: "למחיקה" }, DANA.id);

    await expect(deleteQuote(quote.id)).resolves.toBe(true);

    const db = await getDb();
    await expect(
      db.collection("quote_likes").countDocuments(),
    ).resolves.toBe(0);
    await expect(
      db.collection("quote_comments").countDocuments(),
    ).resolves.toBe(0);
  });
});
