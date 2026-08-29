import { beforeEach, describe, expect, it } from "vitest";

import { GET, POST } from "@/app/api/themes/route";
import { DELETE, GET as GET_ONE, PUT } from "@/app/api/themes/[id]/route";
import { getDb } from "@/lib/mongodb";
import { sessionCookie } from "./factories";

const BASE = "http://localhost:3000/api/themes";

/** Roster people the FK can point at, keyed on the demo directory GUIDs. */
const ROSTER = [
  { directoryId: "8a1f0c2e-4d3b-4a91-9f70-1c2d3e4f5a01", displayName: "נועה ברקת" },
  { directoryId: "d05c3971-1a4e-4b82-97d5-2f6738ec9a55", displayName: "תמר רוזן" },
];

let broughtId: string;
let guessedId: string;

async function seedUsers() {
  const db = await getDb();
  const now = new Date();
  const ids: Record<string, string> = {};
  for (const member of ROSTER) {
    const result = await db.collection("users").insertOne({
      directoryId: member.directoryId,
      username: member.displayName,
      upn: null,
      displayName: member.displayName,
      mail: null,
      dn: `CN=${member.directoryId}`,
      createdAt: now,
      updatedAt: now,
      lastLoginAt: now,
    });
    ids[member.displayName] = result.insertedId.toHexString();
  }
  return ids;
}

function body(overrides: Record<string, unknown> = {}) {
  return {
    date: "2026-08-18",
    broughtById: broughtId,
    theme: "הכול עגול",
    snacks: ["בייגלה", "דונאטס"],
    guessedById: null,
    ...overrides,
  };
}

async function mutate(
  url: string,
  method: string,
  payload?: unknown,
  cookie: string | null | undefined = undefined,
) {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  const value = cookie === undefined ? await sessionCookie() : cookie;
  if (value) headers.cookie = value;

  return new Request(url, {
    method,
    headers,
    body:
      payload === undefined
        ? undefined
        : typeof payload === "string"
          ? payload
          : JSON.stringify(payload),
  });
}

async function post(payload: unknown, cookie?: string | null) {
  return POST(await mutate(BASE, "POST", payload, cookie));
}

function params(id: string) {
  return { params: Promise.resolve({ id }) };
}

async function put(id: string, payload: unknown, cookie?: string | null) {
  return PUT(await mutate(`${BASE}/${id}`, "PUT", payload, cookie), params(id));
}

async function del(id: string, cookie?: string | null) {
  return DELETE(
    await mutate(`${BASE}/${id}`, "DELETE", undefined, cookie),
    params(id),
  );
}

beforeEach(async () => {
  const db = await getDb();
  await db.collection("themes").deleteMany({});
  await db.collection("users").deleteMany({});
  await db.collection("themes").dropIndexes();
  const ids = await seedUsers();
  broughtId = ids["נועה ברקת"];
  guessedId = ids["תמר רוזן"];
});

describe("POST /api/themes", () => {
  it("creates a theme and returns 201 with the saved record", async () => {
    const response = await post(body());
    expect(response.status).toBe(201);

    const theme = await response.json();
    expect(theme.id).toMatch(/^[a-f0-9]{24}$/);
    expect(theme.date).toBe("2026-08-18T00:00:00.000Z");
    expect(theme.broughtBy).toBe("נועה ברקת");
  });

  it("takes addedBy from the session and the names from the roster, not the body", async () => {
    const response = await post(
      body({
        addedBy: "מתחזה",
        broughtBy: "מתחזה",
        guessedById: guessedId,
        guessedBy: "מתחזה",
      }),
    );

    const theme = await response.json();
    // addedBy is the session user (TEST_USER = דנה כהן), never the body.
    expect(theme.addedBy).toBe("דנה כהן");
    // brought/guessed names are resolved from the users rows, never the body.
    expect(theme.broughtBy).toBe("נועה ברקת");
    expect(theme.guessedBy).toBe("תמר רוזן");
  });

  it("rejects invalid input with 422 and Hebrew messages keyed by field", async () => {
    const response = await post(body({ theme: "", date: "2099-01-01" }));
    expect(response.status).toBe(422);

    const payload = await response.json();
    expect(payload.error).toBe("יש שדות לא תקינים");
    expect(payload.issues.theme).toBeTruthy();
    expect(payload.issues.date).toBe("התאריך בעתיד");
  });

  it("rejects a broughtById that resolves to no user with 422 on that field", async () => {
    const response = await post(body({ broughtById: "0".repeat(24) }));
    expect(response.status).toBe(422);

    const payload = await response.json();
    expect(payload.issues.broughtById).toBeTruthy();
    // And nothing was written.
    const db = await getDb();
    await expect(db.collection("themes").countDocuments()).resolves.toBe(0);
  });

  it("returns 409 for a duplicate date, from the unique index", async () => {
    const db = await getDb();
    await db.collection("themes").createIndex({ date: -1 }, { unique: true });

    expect((await post(body())).status).toBe(201);
    const second = await post(body({ theme: "אחר" }));
    expect(second.status).toBe(409);
    await expect(second.json()).resolves.toMatchObject({
      error: "כבר קיים נושא לתאריך הזה",
    });
  });

  it("returns 400 for a malformed JSON body", async () => {
    const response = await post("{not json");
    expect(response.status).toBe(400);
  });
});

describe("GET /api/themes", () => {
  it("is public and returns a page with total and hasMore", async () => {
    await post(body());
    const response = await GET(new Request(BASE));
    expect(response.status).toBe(200);

    const page = await response.json();
    expect(page.total).toBe(1);
    expect(page.hasMore).toBe(false);
  });

  it("filters by the q parameter", async () => {
    await post(body());
    await post(body({ date: "2026-08-11", theme: "מקסיקו", snacks: ["נאצ׳וס"] }));

    const response = await GET(new Request(`${BASE}?q=${encodeURI("מקסיקו")}`));
    const page = await response.json();
    expect(page.themes.map((theme: { theme: string }) => theme.theme)).toEqual([
      "מקסיקו",
    ]);
    expect(page.total).toBe(1);
  });

  it("serves a single theme, 404 on a missing or malformed id", async () => {
    const created = await (await post(body())).json();

    const ok = await GET_ONE(
      new Request(`${BASE}/${created.id}`),
      params(created.id),
    );
    expect(ok.status).toBe(200);

    for (const id of ["0".repeat(24), "not-an-object-id"]) {
      const response = await GET_ONE(new Request(`${BASE}/${id}`), params(id));
      expect(response.status).toBe(404);
    }
  });
});

describe("PUT /api/themes/:id", () => {
  it("updates and returns the record", async () => {
    const created = await (await post(body())).json();
    const response = await put(created.id, body({ theme: "מתוקן" }));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ theme: "מתוקן" });
  });

  it("returns 404 for a missing id and 404 for a malformed one", async () => {
    expect((await put("0".repeat(24), body())).status).toBe(404);
    expect((await put("not-an-object-id", body())).status).toBe(404);
  });

  it("validates before looking the theme up", async () => {
    const response = await put("0".repeat(24), body({ theme: "" }));
    expect(response.status).toBe(422);
  });
});

describe("DELETE /api/themes/:id", () => {
  it("returns 204 then 404 on a repeat", async () => {
    const created = await (await post(body())).json();

    const first = await del(created.id);
    expect(first.status).toBe(204);
    await expect(first.text()).resolves.toBe("");

    expect((await del(created.id)).status).toBe(404);
  });

  it("returns 404 for a malformed id, not 500", async () => {
    expect((await del("nope")).status).toBe(404);
  });
});

describe("authentication and origin", () => {
  const UNAUTHORIZED = { error: "צריך להתחבר כדי לשנות משהו כאן" };

  it.each([
    ["no cookie", null],
    ["a garbage cookie", "zitutim_session=not-a-jwt"],
  ])("rejects POST with %s", async (_label, cookie) => {
    const response = await post(body(), cookie);
    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual(UNAUTHORIZED);
  });

  it("answers 401 before validation, even for a malformed body", async () => {
    // Proves the session check precedes the parse: an anonymous caller learns
    // nothing about the validation rules.
    expect((await post(body({ theme: "" }), null)).status).toBe(401);
    expect((await post("{not json", null)).status).toBe(401);
  });

  it("rejects PUT and DELETE without a session", async () => {
    const created = await (await post(body())).json();
    expect((await put(created.id, body({ theme: "x" }), null)).status).toBe(401);
    expect((await del(created.id, null)).status).toBe(401);
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
    await expect(db.collection("themes").countDocuments()).resolves.toBe(0);
  });

  it("keeps reads public", async () => {
    await post(body());
    const list = await GET(new Request(BASE));
    expect(list.status).toBe(200);
    await expect(list.json()).resolves.toMatchObject({ total: 1 });
  });
});
