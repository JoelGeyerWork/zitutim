import { beforeEach, describe, expect, it, vi } from "vitest";

import { ConfigError } from "@/lib/config-error";
import { getDb } from "@/lib/mongodb";
import { sessionCookie } from "./factories";

// The route's only directory call. Everything else — the users upsert, the
// reviews collection — is the real thing against the in-memory Mongo.
vi.mock("@/lib/ldap", () => ({
  findPersonById: vi.fn(),
  findPeople: vi.fn(),
}));

import { findPersonById } from "@/lib/ldap";
import { GET, POST } from "@/app/api/shotef/reviews/route";

const mockFindPersonById = vi.mocked(findPersonById);

const BASE = "http://localhost:3000/api/shotef/reviews";

/** The two people a review can name, as real `users` rows. */
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

function body(overrides: Record<string, unknown> = {}) {
  return {
    weekStart: "2026-08-16",
    member: { source: "user", id: idByName["דניאל עמר"] },
    rating: 4,
    headline: "שבוע שקט שנגמר בשדרוג",
    body: "שתי תקלות קטנות, שתיהן נסגרו באותו יום.",
    ...overrides,
  };
}

async function post(payload: unknown, cookie: string | null | undefined = undefined) {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  const value = cookie === undefined ? await sessionCookie() : cookie;
  if (value) headers.cookie = value;

  return POST(
    new Request(BASE, {
      method: "POST",
      headers,
      body: typeof payload === "string" ? payload : JSON.stringify(payload),
    }),
  );
}

beforeEach(async () => {
  const db = await getDb();
  await db.collection("shotef_reviews").deleteMany({});
  await db.collection("users").deleteMany({});
  idByName = await seedUsers();
  mockFindPersonById.mockReset();
});

describe("POST /api/shotef/reviews", () => {
  it("creates a summary and returns 201 with the saved record", async () => {
    const response = await post(body());
    expect(response.status).toBe(201);

    const review = await response.json();
    expect(review.id).toMatch(/^[a-f0-9]{24}$/);
    expect(review.weekStart).toBe("2026-08-16T00:00:00.000Z");
    expect(review.memberId).toBe(idByName["דניאל עמר"]);
    expect(review.rating).toBe(4);
  });

  it("accepts a rating of zero — a week that went badly is worth recording", async () => {
    const response = await post(body({ rating: 0 }));
    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toMatchObject({ rating: 0 });
  });

  it("takes the author from the session, and never from the body", async () => {
    const created = await (await post(body({ addedBy: "מתחזה" }))).json();

    const db = await getDb();
    const doc = await db
      .collection("shotef_reviews")
      .findOne({ headline: created.headline });

    // TEST_USER is דנה כהן; the body's "author" is not a field at all.
    expect(doc!.addedBy).toBe("דנה כהן");
    // And whose week it was stays what the form said.
    expect(doc!.memberId.toHexString()).toBe(idByName["דניאל עמר"]);
  });

  it("rejects a week that does not start on a Sunday with 422", async () => {
    // 2026-08-17 is a Monday — a shift is a whole Sunday-to-Saturday week.
    const response = await post(body({ weekStart: "2026-08-17" }));
    expect(response.status).toBe(422);

    const payload = await response.json();
    expect(payload.error).toBe("יש שדות לא תקינים");
    expect(payload.issues.weekStart).toBe("שבוע תורנות מתחיל ביום ראשון");

    const db = await getDb();
    await expect(db.collection("shotef_reviews").countDocuments()).resolves.toBe(0);
  });

  it("rejects the rest of the invalid input with 422 and Hebrew messages by field", async () => {
    const response = await post(body({ rating: 9, headline: "", body: "קצר" }));
    expect(response.status).toBe(422);

    const payload = await response.json();
    expect(payload.issues.rating).toBe("הציון נגמר בחמש");
    expect(payload.issues.headline).toBeTruthy();
    expect(payload.issues.body).toBeTruthy();
  });

  it("rejects a member reference that resolves to no user with 422 on that field", async () => {
    for (const id of ["0".repeat(24), "daniel"]) {
      const response = await post(body({ member: { source: "user", id } }));
      expect(response.status).toBe(422);
      await expect(response.json()).resolves.toMatchObject({
        issues: { member: "לא נמצא ברשימה" },
      });
    }

    const db = await getDb();
    await expect(db.collection("shotef_reviews").countDocuments()).resolves.toBe(0);
  });

  // The point of the directory search on this form: a week worked by somebody
  // who has since left the rotation — or was never on it — must still be
  // writable in their name.
  it("names somebody found in the directory, re-resolving them server-side", async () => {
    mockFindPersonById.mockResolvedValue({
      directoryId: "guid-roi",
      displayName: "רועי אשכנזי",
      title: "אבטחת מידע",
      username: "roi.ashkenazi",
    });

    const response = await post(
      // No name in the body at all — only the id the route looks up itself.
      body({ member: { source: "directory", id: "guid-roi" } }),
    );

    expect(response.status).toBe(201);
    const review = await response.json();
    expect(review.memberName).toBe("רועי אשכנזי");

    const db = await getDb();
    const row = await db.collection("users").findOne({ directoryId: "guid-roi" });
    expect(row!._id.toHexString()).toBe(review.memberId);
  });

  // The directory is the *addition*, not the replacement: there is usually no
  // domain controller reachable, and the rotation's own default must not start
  // depending on one.
  it("never touches the directory for a member the app already holds", async () => {
    mockFindPersonById.mockRejectedValue(new Error("directory unavailable"));

    const response = await post(body());
    expect(response.status).toBe(201);
    expect(mockFindPersonById).not.toHaveBeenCalled();
  });

  it("rejects a directoryId that resolves to nobody with 422, not a 5xx", async () => {
    mockFindPersonById.mockResolvedValue(null);

    const response = await post(
      body({ member: { source: "directory", id: "guid-nobody" } }),
    );

    expect(response.status).toBe(422);
    await expect(response.json()).resolves.toMatchObject({
      issues: { member: "לא נמצא ברשימה" },
    });

    const db = await getDb();
    await expect(db.collection("shotef_reviews").countDocuments()).resolves.toBe(0);
  });

  // A directory outage and a server that was never configured send whoever
  // investigates to opposite places, so they answer differently — the same
  // split `POST /api/rotation` and the login route draw.
  it("answers 503 when the directory cannot be reached", async () => {
    mockFindPersonById.mockRejectedValue(new Error("directory unavailable"));

    const response = await post(
      body({ member: { source: "directory", id: "guid-roi" } }),
    );

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({
      error: "לא הצלחנו לפנות לספריית הארגון",
    });
  });

  it("answers 500 when the directory is not configured on this server", async () => {
    mockFindPersonById.mockRejectedValue(new ConfigError("LDAP_URL is not set"));

    const response = await post(
      body({ member: { source: "directory", id: "guid-roi" } }),
    );

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toMatchObject({
      error: "החיפוש בספרייה לא מוגדר בשרת",
    });
  });

  // Relies on the index the app declares, not one built here — see the note in
  // `shotef-reviews.test.ts`.
  it("returns 409 for a week that already has a summary", async () => {
    const db = await getDb();

    expect((await post(body())).status).toBe(201);

    // A different member and a different headline — it is the *week* that is
    // taken, and the picker dropping it is a courtesy, not the enforcement.
    const second = await post(
      body({
        member: { source: "user", id: idByName["תמר רוזן"] },
        headline: "אותו שבוע, סיפור אחר",
      }),
    );
    expect(second.status).toBe(409);
    await expect(second.json()).resolves.toMatchObject({
      error: "כבר יש סיכום לשבוע הזה",
    });

    await expect(db.collection("shotef_reviews").countDocuments()).resolves.toBe(1);
  });

  it("returns 400 for a malformed JSON body", async () => {
    expect((await post("{not json")).status).toBe(400);
  });

  it("answers 401 before validation, so anonymous callers learn nothing", async () => {
    expect((await post(body(), null)).status).toBe(401);
    // Neither an invalid body nor an unparseable one becomes a 422 or a 400.
    expect((await post(body({ rating: 99 }), null)).status).toBe(401);
    expect((await post("{not json", null)).status).toBe(401);

    const db = await getDb();
    await expect(db.collection("shotef_reviews").countDocuments()).resolves.toBe(0);
  });

  it("rejects a cross-origin POST even with a valid session", async () => {
    const response = await POST(
      new Request(BASE, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          cookie: await sessionCookie(),
          origin: "https://evil.example",
        },
        body: JSON.stringify(body()),
      }),
    );

    expect(response.status).toBe(403);
    const db = await getDb();
    await expect(db.collection("shotef_reviews").countDocuments()).resolves.toBe(0);
  });
});

describe("GET /api/shotef/reviews", () => {
  it("is public and returns the reviews newest week first, with the average", async () => {
    await post(body({ weekStart: "2026-08-02", rating: 3 }));
    await post(body({ weekStart: "2026-08-16", rating: 5 }));
    await post(body({ weekStart: "2026-08-09", rating: 4 }));

    const response = await GET();
    expect(response.status).toBe(200);

    const payload = await response.json();
    expect(payload.total).toBe(3);
    expect(payload.average).toBe(4);
    expect(payload.reviews.map((review: { weekStart: string }) => review.weekStart)).toEqual([
      "2026-08-16T00:00:00.000Z",
      "2026-08-09T00:00:00.000Z",
      "2026-08-02T00:00:00.000Z",
    ]);
  });

  it("answers an empty list on a fresh database", async () => {
    await expect((await GET()).json()).resolves.toEqual({
      reviews: [],
      total: 0,
      average: 0,
    });
  });
});
