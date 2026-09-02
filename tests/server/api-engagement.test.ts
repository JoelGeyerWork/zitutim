import { ObjectId } from "mongodb";
import { beforeEach, describe, expect, it } from "vitest";

import {
  GET as GET_COMMENTS,
  POST as POST_COMMENT,
} from "@/app/api/quotes/[id]/comments/route";
import {
  DELETE as DELETE_COMMENT,
  PUT as PUT_COMMENT,
} from "@/app/api/quotes/[id]/comments/[commentId]/route";
import { PUT as PUT_LIKE } from "@/app/api/quotes/[id]/like/route";
import { getDb } from "@/lib/mongodb";
import { createQuote, type QuoteActor } from "@/lib/quotes";
import type { QuoteComment } from "@/lib/engagement-schema";
import type { SessionUser } from "@/lib/auth-schema";
import { TEST_USER, authedRequest, nameRef, namedAuthor } from "./factories";

const BASE = "http://localhost:3000/api/quotes";
const ACTOR: QuoteActor = { id: TEST_USER.id, name: TEST_USER.name };
const OTHER_USER: SessionUser = {
  id: "6b0000000000000000000002",
  name: "נועה לוי",
  username: "noa",
};

function quoteParams(id: string) {
  return { params: Promise.resolve({ id }) };
}

function commentParams(id: string, commentId: string) {
  return { params: Promise.resolve({ id, commentId }) };
}

async function jsonRequest(
  url: string,
  method: string,
  body: unknown,
  user: SessionUser = TEST_USER,
) {
  return authedRequest(
    url,
    {
      method,
      headers: { "Content-Type": "application/json" },
      body: typeof body === "string" ? body : JSON.stringify(body),
    },
    user,
  );
}

async function insertUser(user: SessionUser) {
  const db = await getDb();
  const now = new Date("2026-08-20T09:00:00.000Z");
  await db.collection("users").insertOne({
    _id: new ObjectId(user.id),
    directoryId: `directory-${user.id}`,
    username: user.username,
    displayName: user.name,
    createdAt: now,
    updatedAt: now,
    lastLoginAt: now,
  });
}

async function createTestQuote() {
  return createQuote(
    {
      text: "תמיד יש זמן לעוד קפה אחד",
      author: nameRef("דנה"),
      saidAt: "2026-07-28",
      context: null,
    },
    namedAuthor("דנה"),
    ACTOR,
  );
}

beforeEach(async () => {
  const db = await getDb();
  await Promise.all([
    db.collection("quotes").deleteMany({}),
    db.collection("quote_likes").deleteMany({}),
    db.collection("quote_comments").deleteMany({}),
    db.collection("users").deleteMany({}),
  ]);
  await Promise.all([insertUser(TEST_USER), insertUser(OTHER_USER)]);
});

describe("PUT /api/quotes/:id/like", () => {
  it("sets and removes one like idempotently", async () => {
    const quote = await createTestQuote();
    const url = `${BASE}/${quote.id}/like`;

    for (const liked of [true, true, false]) {
      const response = await PUT_LIKE(
        await jsonRequest(url, "PUT", { liked }),
        quoteParams(quote.id),
      );
      expect(response.status).toBe(200);
    }

    const db = await getDb();
    await expect(
      db.collection("quote_likes").countDocuments(),
    ).resolves.toBe(0);
  });

  it("requires a session before parsing and validates signed-in input", async () => {
    const quote = await createTestQuote();
    const url = `${BASE}/${quote.id}/like`;

    const anonymous = await PUT_LIKE(
      new Request(url, { method: "PUT", body: "{bad" }),
      quoteParams(quote.id),
    );
    expect(anonymous.status).toBe(401);

    const invalid = await PUT_LIKE(
      await jsonRequest(url, "PUT", { liked: "yes" }),
      quoteParams(quote.id),
    );
    expect(invalid.status).toBe(422);
    await expect(invalid.json()).resolves.toMatchObject({
      issues: { liked: "צריך לציין אם לסמן לייק" },
    });
  });

  it("rejects cross-origin writes and returns 404 for a missing quote", async () => {
    const quote = await createTestQuote();
    const crossOrigin = await authedRequest(`${BASE}/${quote.id}/like`, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        origin: "https://evil.example",
      },
      body: JSON.stringify({ liked: true }),
    });
    expect(
      (
        await PUT_LIKE(crossOrigin, quoteParams(quote.id))
      ).status,
    ).toBe(403);

    const missing = "0".repeat(24);
    expect(
      (
        await PUT_LIKE(
          await jsonRequest(`${BASE}/${missing}/like`, "PUT", {
            liked: true,
          }),
          quoteParams(missing),
        )
      ).status,
    ).toBe(404);
  });
});

describe("/api/quotes/:id/comments", () => {
  it("keeps reads public and returns current user names", async () => {
    const quote = await createTestQuote();
    const post = await POST_COMMENT(
      await jsonRequest(`${BASE}/${quote.id}/comments`, "POST", {
        text: "תגובה ציבורית",
      }),
      quoteParams(quote.id),
    );
    expect(post.status).toBe(201);

    const db = await getDb();
    await db.collection("users").updateOne(
      { _id: new ObjectId(TEST_USER.id) },
      { $set: { displayName: "דנה בשם החדש" } },
    );

    const response = await GET_COMMENTS(
      new Request(`${BASE}/${quote.id}/comments`),
      quoteParams(quote.id),
    );
    expect(response.status).toBe(200);
    const payload: { comments: QuoteComment[] } = await response.json();
    expect(payload.comments[0]).toMatchObject({
      text: "תגובה ציבורית",
      authorName: "דנה בשם החדש",
    });
  });

  it("trims comments and rejects empty or overlong text with 422", async () => {
    const quote = await createTestQuote();
    const url = `${BASE}/${quote.id}/comments`;

    const empty = await POST_COMMENT(
      await jsonRequest(url, "POST", { text: "   " }),
      quoteParams(quote.id),
    );
    expect(empty.status).toBe(422);
    await expect(empty.json()).resolves.toMatchObject({
      issues: { text: "צריך לכתוב תגובה" },
    });

    const long = await POST_COMMENT(
      await jsonRequest(url, "POST", { text: "א".repeat(1001) }),
      quoteParams(quote.id),
    );
    expect(long.status).toBe(422);
  });

  it("answers 401 before body parsing and blocks cross-origin creation", async () => {
    const quote = await createTestQuote();
    const url = `${BASE}/${quote.id}/comments`;

    const anonymous = await POST_COMMENT(
      new Request(url, { method: "POST", body: "{bad" }),
      quoteParams(quote.id),
    );
    expect(anonymous.status).toBe(401);

    const crossOrigin = await authedRequest(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        origin: "https://evil.example",
      },
      body: JSON.stringify({ text: "תגובה" }),
    });
    expect(
      (
        await POST_COMMENT(crossOrigin, quoteParams(quote.id))
      ).status,
    ).toBe(403);
  });

  it("returns 404 for public reads and writes against a missing quote", async () => {
    const missing = "0".repeat(24);
    const url = `${BASE}/${missing}/comments`;

    expect(
      (
        await GET_COMMENTS(new Request(url), quoteParams(missing))
      ).status,
    ).toBe(404);
    expect(
      (
        await POST_COMMENT(
          await jsonRequest(url, "POST", { text: "תגובה" }),
          quoteParams(missing),
        )
      ).status,
    ).toBe(404);
  });
});

describe("/api/quotes/:id/comments/:commentId", () => {
  async function createApiComment(quoteId: string): Promise<QuoteComment> {
    const response = await POST_COMMENT(
      await jsonRequest(`${BASE}/${quoteId}/comments`, "POST", {
        text: "תגובה מקורית",
      }),
      quoteParams(quoteId),
    );
    return response.json();
  }

  it("lets the author edit without changing authorship or creation time", async () => {
    const quote = await createTestQuote();
    const original = await createApiComment(quote.id);
    const url = `${BASE}/${quote.id}/comments/${original.id}`;

    const response = await PUT_COMMENT(
      await jsonRequest(url, "PUT", { text: "תגובה מתוקנת" }),
      commentParams(quote.id, original.id),
    );
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      text: "תגובה מתוקנת",
      authorId: TEST_USER.id,
      createdAt: original.createdAt,
    });
  });

  it("returns 403 when another signed-in user edits or deletes", async () => {
    const quote = await createTestQuote();
    const comment = await createApiComment(quote.id);
    const url = `${BASE}/${quote.id}/comments/${comment.id}`;

    const edit = await PUT_COMMENT(
      await jsonRequest(url, "PUT", { text: "חטיפה" }, OTHER_USER),
      commentParams(quote.id, comment.id),
    );
    expect(edit.status).toBe(403);

    const remove = await DELETE_COMMENT(
      await authedRequest(url, { method: "DELETE" }, OTHER_USER),
      commentParams(quote.id, comment.id),
    );
    expect(remove.status).toBe(403);
  });

  it("lets the author delete and returns 404 for missing comments", async () => {
    const quote = await createTestQuote();
    const comment = await createApiComment(quote.id);
    const url = `${BASE}/${quote.id}/comments/${comment.id}`;

    const removed = await DELETE_COMMENT(
      await authedRequest(url, { method: "DELETE" }),
      commentParams(quote.id, comment.id),
    );
    expect(removed.status).toBe(204);

    const repeated = await DELETE_COMMENT(
      await authedRequest(url, { method: "DELETE" }),
      commentParams(quote.id, comment.id),
    );
    expect(repeated.status).toBe(404);
  });

  it("requires auth before edit validation and checks origin on delete", async () => {
    const quote = await createTestQuote();
    const comment = await createApiComment(quote.id);
    const url = `${BASE}/${quote.id}/comments/${comment.id}`;

    const anonymous = await PUT_COMMENT(
      new Request(url, { method: "PUT", body: "{bad" }),
      commentParams(quote.id, comment.id),
    );
    expect(anonymous.status).toBe(401);

    const crossOrigin = await authedRequest(url, {
      method: "DELETE",
      headers: { origin: "https://evil.example" },
    });
    expect(
      (
        await DELETE_COMMENT(
          crossOrigin,
          commentParams(quote.id, comment.id),
        )
      ).status,
    ).toBe(403);
  });
});
