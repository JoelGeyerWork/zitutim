import { ObjectId } from "mongodb";
import { beforeEach, describe, expect, it } from "vitest";

import { getDb } from "@/lib/mongodb";
import {
  createShotefReview,
  findReviewMember,
  getReviewStats,
  getShotefReviews,
  listShotefReviews,
  type ReviewActor,
  type ReviewMember,
  type ShotefReviewDoc,
} from "@/lib/shotef-reviews";
import { type ReviewInput } from "@/lib/shotef-schema";

const AUTHOR: ReviewActor = { id: "6b0000000000000000000001", name: "דנה כהן" };

/** The two people a review can name, seeded as real `users` rows. */
const PEOPLE = [
  { directoryId: "3e82a5d0-77b9-4c46-8f11-6b0c94ae2d44", displayName: "דניאל עמר" },
  { directoryId: "d05c3971-1a4e-4b82-97d5-2f6738ec9a55", displayName: "תמר רוזן" },
];

let idByName: Record<string, string>;

async function seedUsers(): Promise<Record<string, string>> {
  const db = await getDb();
  const now = new Date();
  const ids: Record<string, string> = {};
  for (const person of PEOPLE) {
    const result = await db.collection("users").insertOne({
      directoryId: person.directoryId,
      username: person.displayName,
      upn: null,
      displayName: person.displayName,
      title: null,
      mail: null,
      dn: `CN=${person.directoryId}`,
      createdAt: now,
      updatedAt: now,
      lastLoginAt: now,
    });
    ids[person.displayName] = result.insertedId.toHexString();
  }
  return ids;
}

function input(overrides: Partial<ReviewInput> = {}): ReviewInput {
  return {
    // A Sunday, which is the only thing the schema will take.
    weekStart: "2026-08-16",
    memberId: idByName["דניאל עמר"],
    rating: 5,
    headline: "שבוע שקט שנגמר בשדרוג",
    body: "שתי תקלות קטנות, שתיהן נסגרו באותו יום.",
    ...overrides,
  };
}

/** The resolved row the route hands the create, keyed by display name. */
function member(name = "דניאל עמר"): ReviewMember {
  return { id: idByName[name], name };
}

/** `createShotefReview(input(), member(), AUTHOR)`, which is most of the file. */
function create(overrides: Partial<ReviewInput> = {}, name?: string) {
  return createShotefReview(input(overrides), member(name), AUTHOR);
}

beforeEach(async () => {
  const db = await getDb();
  await db.collection("shotef_reviews").deleteMany({});
  await db.collection("users").deleteMany({});
  idByName = await seedUsers();
});

describe("createShotefReview", () => {
  it("stores weekStart at UTC midnight and memberId as an ObjectId", async () => {
    const review = await create();

    expect(review.id).toMatch(/^[a-f0-9]{24}$/);
    expect(review.weekStart).toBe("2026-08-16T00:00:00.000Z");
    expect(review.memberId).toBe(idByName["דניאל עמר"]);

    const db = await getDb();
    const doc = await db
      .collection<ShotefReviewDoc>("shotef_reviews")
      .findOne({ _id: new ObjectId(review.id) });

    // The stored FK is an ObjectId, not the hex string the client sees — it has
    // to be the same value `users._id` holds for a $lookup or an $in to match.
    expect(doc!.memberId).toBeInstanceOf(ObjectId);
    expect(doc!.memberId.toHexString()).toBe(idByName["דניאל עמר"]);
    expect(doc!.weekStart.toISOString()).toBe("2026-08-16T00:00:00.000Z");
  });

  it("records who typed it in from the actor, never from the input", async () => {
    const review = await create();

    const db = await getDb();
    const doc = await db
      .collection<ShotefReviewDoc>("shotef_reviews")
      .findOne({ _id: new ObjectId(review.id) });

    expect(doc!.addedBy).toBe("דנה כהן");
    expect(doc!.addedById!.toHexString()).toBe(AUTHOR.id);
    // Whose week it was is a different fact, and it is the one the form asks for.
    expect(doc!.memberId.toHexString()).toBe(idByName["דניאל עמר"]);
    // The serialized review carries neither — `ShotefReview` has no author field.
    expect(review).not.toHaveProperty("addedBy");
  });

  it("keeps a rating of zero, which is a real score", async () => {
    const review = await create({ rating: 0 });
    expect(review.rating).toBe(0);

    const stored = await listShotefReviews();
    expect(stored[0].rating).toBe(0);
  });

  it("refuses a second summary for the same week off the unique index", async () => {
    const db = await getDb();
    await db
      .collection("shotef_reviews")
      .createIndex({ weekStart: -1 }, { unique: true });

    await create();
    await expect(
      create(
        { memberId: idByName["תמר רוזן"], headline: "אותו שבוע, סיפור אחר" },
        "תמר רוזן",
      ),
    ).rejects.toMatchObject({ code: 11000 });

    await expect(
      db.collection("shotef_reviews").countDocuments(),
    ).resolves.toBe(1);
  });
});

describe("listShotefReviews", () => {
  it("reads newest week first, whatever order they were written in", async () => {
    await create({ weekStart: "2026-08-02" });
    await create({ weekStart: "2026-08-16" });
    await create({ weekStart: "2026-08-09" });

    const list = await listShotefReviews();
    expect(list.map((review) => review.weekStart)).toEqual([
      "2026-08-16T00:00:00.000Z",
      "2026-08-09T00:00:00.000Z",
      "2026-08-02T00:00:00.000Z",
    ]);
  });

  it("is empty on a fresh database rather than throwing", async () => {
    await expect(listShotefReviews()).resolves.toEqual([]);
  });
});

describe("getReviewStats", () => {
  it("averages across every review, to one decimal", async () => {
    for (const [week, rating] of [
      ["2026-08-16", 5],
      ["2026-08-09", 4],
      ["2026-08-02", 3],
      ["2026-07-26", 5],
    ] as const) {
      await create({ weekStart: week, rating });
    }

    // 17 / 4 = 4.25 → 4.3, the same rounding `averageRating` applies.
    await expect(getReviewStats()).resolves.toEqual({ total: 4, average: 4.3 });
  });

  it("counts a zero rating rather than skipping it", async () => {
    await create({ weekStart: "2026-08-16", rating: 0 });
    await create({ weekStart: "2026-08-09", rating: 4 });

    await expect(getReviewStats()).resolves.toEqual({ total: 2, average: 2 });
  });

  it("is zero on an empty collection", async () => {
    await expect(getReviewStats()).resolves.toEqual({ total: 0, average: 0 });
  });
});

describe("getShotefReviews", () => {
  it("returns the list and the aggregate together", async () => {
    await create({ weekStart: "2026-08-16", rating: 5 });
    await create({ weekStart: "2026-08-09", rating: 2 });

    const page = await getShotefReviews();
    expect(page.reviews).toHaveLength(2);
    expect(page.total).toBe(2);
    expect(page.average).toBe(3.5);
  });
});

describe("findReviewMember", () => {
  it("resolves a seeded user to the name the review will carry", async () => {
    await expect(findReviewMember(idByName["תמר רוזן"])).resolves.toEqual({
      id: idByName["תמר רוזן"],
      name: "תמר רוזן",
    });
  });

  it("answers null for anything that is not a known user", async () => {
    await expect(findReviewMember("0".repeat(24))).resolves.toBeNull();
    // The schema takes any non-empty string, so a slug reaches this unparsed —
    // it must answer null rather than throw on an invalid ObjectId.
    await expect(findReviewMember("tamar")).resolves.toBeNull();
    await expect(findReviewMember("")).resolves.toBeNull();
  });
});
