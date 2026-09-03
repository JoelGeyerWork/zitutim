import { beforeEach, describe, expect, it, vi } from "vitest";

import { ConfigError } from "@/lib/config-error";
import { getDb } from "@/lib/mongodb";

// The route's only directory call. Everything else — the users upsert, the
// quotes collection — is the real thing against the in-memory Mongo.
vi.mock("@/lib/ldap", () => ({
  findPersonById: vi.fn(),
  findPeople: vi.fn(),
}));

import { findPersonById } from "@/lib/ldap";
import { GET, POST } from "@/app/api/quotes/route";
import {
  DELETE,
  GET as GET_ONE,
  PUT,
} from "@/app/api/quotes/[id]/route";
import { createQuote, type QuoteActor } from "@/lib/quotes";
import type { Quote, QuotePage, QuoteValues } from "@/lib/quote-schema";
import { TEST_USER, nameRef, namedAuthor, sessionCookie } from "./factories";

const mockFindPersonById = vi.mocked(findPersonById);

const ROI = {
  directoryId: "0b8a1f2e-4d3b-4a91-9f70-1c2d3e4f5a09",
  displayName: "רועי אשכנזי",
  title: "אבטחת מידע",
  username: "roi.ashkenazi",
  upn: null,
  mail: null,
  dn: "CN=roi.ashkenazi",
};

const BASE = "http://localhost:3000/api/quotes";

const ACTOR: QuoteActor = { id: TEST_USER.id, name: TEST_USER.name };

/**
 * `author` is a reference, like every other form here sends — a plain name by
 * default, which is the arm that resolves to itself and touches no directory.
 */
function body(overrides: Record<string, unknown> = {}) {
  return {
    text: "תמיד יש זמן לעוד קפה אחד",
    author: nameRef("דנה"),
    saidAt: "2026-07-28",
    context: null,
    ...overrides,
  };
}

/** A stored quote, straight through the data layer. */
function store(overrides: Record<string, unknown> = {}) {
  const author =
    typeof overrides.author === "string" ? overrides.author : "דנה";
  return createQuote(
    body({ ...overrides, author: nameRef(author) }) as QuoteValues,
    namedAuthor(author),
    ACTOR,
  );
}

/** A real `users` row, as the person a `{ source: "user" }` reference names. */
async function insertUser(displayName: string): Promise<string> {
  const now = new Date();
  const db = await getDb();
  const result = await db.collection("users").insertOne({
    directoryId: `directory-${displayName}`,
    username: displayName,
    upn: null,
    displayName,
    title: null,
    mail: null,
    dn: `CN=${displayName}`,
    createdAt: now,
    updatedAt: now,
    lastLoginAt: now,
  });
  return result.insertedId.toHexString();
}

/** A mutating request carrying a real signed session, unless told otherwise. */
async function mutate(
  url: string,
  method: string,
  payload?: unknown,
  cookie: string | null | undefined = undefined,
) {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
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

beforeEach(async () => {
  const db = await getDb();
  await db.collection("quotes").deleteMany({});
  await db.collection("users").deleteMany({});
  mockFindPersonById.mockReset();
});

describe("POST /api/quotes", () => {
  it("creates a quote and returns 201 with the saved record", async () => {
    const response = await post(body());
    expect(response.status).toBe(201);

    const quote: Quote = await response.json();
    expect(quote.id).toMatch(/^[a-f0-9]{24}$/);
    expect(quote.author).toBe("דנה");
    // A typed name is a name and nothing else — nobody to point at.
    expect(quote.authorId).toBeNull();
    expect(quote.saidAt).toBe("2026-07-28T00:00:00.000Z");
  });

  it("attributes the quote to the session, ignoring any addedBy in the body", async () => {
    const response = await post(body({ addedBy: "מישהו אחר" }));

    const quote: Quote = await response.json();
    expect(quote.addedBy).toBe(TEST_USER.name);
    expect(quote.addedById).toBe(TEST_USER.id);
  });

  it("rejects invalid input with 422 and per-field Hebrew messages", async () => {
    const response = await post(body({ author: "", saidAt: "2099-01-01" }));
    expect(response.status).toBe(422);

    const payload = await response.json();
    expect(payload.error).toBe("יש שדות לא תקינים");
    expect(payload.issues).toEqual({
      author: "צריך לציין מי אמר",
      saidAt: "התאריך בעתיד",
    });
  });

  it("keys issues by field so the form can render them inline", async () => {
    const response = await post(body({ text: "   " }));
    const payload = await response.json();
    expect(Object.keys(payload.issues)).toEqual(["text"]);
  });

  it("returns 400 for a malformed JSON body", async () => {
    const response = await post("{not json");
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: "בקשה לא תקינה" });
  });

  it("does not persist anything when validation fails", async () => {
    await post(body({ author: "" }));
    const db = await getDb();
    await expect(db.collection("quotes").countDocuments()).resolves.toBe(0);
  });
});


describe("POST /api/quotes — who said it", () => {
  it("takes the name off the users row the reference names", async () => {
    const id = await insertUser("נועה ברקת");
    // Whatever the client thinks the name is, it is not what gets stored.
    const response = await post(body({ author: { source: "user", id } }));

    expect(response.status).toBe(201);
    const quote: Quote = await response.json();
    expect(quote.author).toBe("נועה ברקת");
    expect(quote.authorId).toBe(id);
  });

  it("never touches the directory for somebody the app already holds", async () => {
    // There is no domain controller on the development network and there may be
    // none during an outage in production. Quoting a teammate must not care.
    mockFindPersonById.mockRejectedValue(new Error("no domain controller"));
    const id = await insertUser("נועה ברקת");

    const response = await post(body({ author: { source: "user", id } }));

    expect(response.status).toBe(201);
    expect(mockFindPersonById).not.toHaveBeenCalled();
  });

  it("quotes somebody found in the directory, giving them a users row", async () => {
    mockFindPersonById.mockResolvedValue(ROI);

    const response = await post(
      body({ author: { source: "directory", id: ROI.directoryId } }),
    );

    expect(response.status).toBe(201);
    const quote: Quote = await response.json();
    expect(quote.author).toBe(ROI.displayName);

    // Re-resolved server-side and written through `upsertRosterUser`, so the
    // stored name came from the directory rather than from the request.
    expect(mockFindPersonById).toHaveBeenCalledWith(ROI.directoryId);
    const db = await getDb();
    const row = await db
      .collection("users")
      .findOne({ directoryId: ROI.directoryId });
    expect(row?._id.toHexString()).toBe(quote.authorId);
  });

  it("reports a reference that names nobody as a 422 on the field", async () => {
    const response = await post(
      body({ author: { source: "user", id: "0".repeat(24) } }),
    );

    expect(response.status).toBe(422);
    await expect(response.json()).resolves.toMatchObject({
      issues: { author: "לא מצאנו את מי שנבחר" },
    });

    const db = await getDb();
    await expect(db.collection("quotes").countDocuments()).resolves.toBe(0);
  });

  it("answers 503 when the directory cannot be reached", async () => {
    mockFindPersonById.mockRejectedValue(new Error("ECONNRESET"));

    const response = await post(
      body({ author: { source: "directory", id: ROI.directoryId } }),
    );
    expect(response.status).toBe(503);
  });

  it("answers 500 when the directory is not configured here", async () => {
    // Someone else's outage and this server's own misconfiguration send whoever
    // investigates to opposite places, so they are never the same status.
    mockFindPersonById.mockRejectedValue(new ConfigError("LDAP_URL is not set"));

    const response = await post(
      body({ author: { source: "directory", id: ROI.directoryId } }),
    );
    expect(response.status).toBe(500);
  });
});

describe("GET /api/quotes", () => {
  beforeEach(async () => {
    await store({ author: "דנה" });
    await store({ author: "עומר", text: "בואו נדחה את זה" });
  });

  it("returns a page with the total and a hasMore flag", async () => {
    const response = await GET(new Request(BASE));
    expect(response.status).toBe(200);

    const page: QuotePage = await response.json();
    expect(page.quotes).toHaveLength(2);
    expect(page.total).toBe(2);
    expect(page.hasMore).toBe(false);
  });

  it("filters by the q parameter", async () => {
    const response = await GET(new Request(`${BASE}?q=${encodeURI("נדחה")}`));
    const page: QuotePage = await response.json();
    expect(page.quotes.map((quote) => quote.author)).toEqual(["עומר"]);
  });

  it("honours skip and limit", async () => {
    const first: QuotePage = await (
      await GET(new Request(`${BASE}?limit=1`))
    ).json();
    expect(first.quotes).toHaveLength(1);
    expect(first.hasMore).toBe(true);

    const second: QuotePage = await (
      await GET(new Request(`${BASE}?skip=1&limit=1`))
    ).json();
    expect(second.quotes[0].id).not.toBe(first.quotes[0].id);
    expect(second.hasMore).toBe(false);
  });

  it("applies a known sort", async () => {
    const page: QuotePage = await (
      await GET(new Request(`${BASE}?sort=author`))
    ).json();
    expect(page.quotes.map((quote) => quote.author)).toEqual(["דנה", "עומר"]);
  });

  it("ignores an unknown sort instead of erroring", async () => {
    const response = await GET(new Request(`${BASE}?sort=drop-table`));
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ total: 2 });
  });

  it("ignores non-numeric skip and limit values", async () => {
    const response = await GET(new Request(`${BASE}?skip=abc&limit=abc`));
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ total: 2 });
  });
});

describe("GET /api/quotes/:id", () => {
  it("returns the quote", async () => {
    const created = await store();
    const response = await GET_ONE(
      new Request(`${BASE}/${created.id}`),
      params(created.id),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ id: created.id });
  });

  it.each([
    ["a missing id", "0".repeat(24)],
    ["a malformed id", "not-an-object-id"],
  ])("returns 404 for %s", async (_label, id) => {
    const response = await GET_ONE(new Request(`${BASE}/${id}`), params(id));
    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({ error: "הציטוט לא נמצא" });
  });
});

async function put(id: string, payload: unknown, cookie?: string | null) {
  return PUT(
    await mutate(`${BASE}/${id}`, "PUT", payload, cookie),
    params(id),
  );
}

async function del(id: string, cookie?: string | null) {
  return DELETE(
    await mutate(`${BASE}/${id}`, "DELETE", undefined, cookie),
    params(id),
  );
}

describe("PUT /api/quotes/:id", () => {
  it("replaces the quote and returns the updated record", async () => {
    const created = await store();
    const response = await put(created.id, body({ text: "ניסוח מתוקן" }));

    expect(response.status).toBe(200);
    const quote: Quote = await response.json();
    expect(quote.text).toBe("ניסוח מתוקן");
    expect(quote.createdAt).toBe(created.createdAt);
  });

  it("returns 422 for invalid input", async () => {
    const created = await store();
    const response = await put(created.id, body({ text: "" }));
    expect(response.status).toBe(422);
  });

  it("re-points the quote when the speaker is picked again", async () => {
    const created = await store();
    expect(created.authorId).toBeNull();

    const id = await insertUser("נועה ברקת");
    const response = await put(
      created.id,
      body({ author: { source: "user", id } }),
    );

    const quote: Quote = await response.json();
    expect(quote.author).toBe("נועה ברקת");
    expect(quote.authorId).toBe(id);
  });

  it("keeps a typed name typed, so an old quote stays editable", async () => {
    // Every quote added before the picker has a name and no id, and the speaker
    // may be someone the directory cannot answer for at all. Editing the text
    // must not demand that they be found.
    const created = await store({ author: "שירה מהלקוח" });

    const response = await put(
      created.id,
      body({ author: nameRef("שירה מהלקוח"), text: "ניסוח מתוקן" }),
    );

    expect(response.status).toBe(200);
    const quote: Quote = await response.json();
    expect(quote.author).toBe("שירה מהלקוח");
    expect(quote.authorId).toBeNull();
    expect(mockFindPersonById).not.toHaveBeenCalled();
  });

  it("returns 400 for a malformed body", async () => {
    const created = await store();
    await expect(put(created.id, "{nope")).resolves.toMatchObject({
      status: 400,
    });
  });

  it("returns 404 for an id that does not exist", async () => {
    const response = await put("0".repeat(24), body());
    expect(response.status).toBe(404);
  });

  it("validates before looking the quote up", async () => {
    // A bad body against a missing id is a validation problem, not a 404.
    const response = await put("0".repeat(24), body({ author: "" }));
    expect(response.status).toBe(422);
  });
});

describe("DELETE /api/quotes/:id", () => {
  it("returns 204 with an empty body, then 404 on a repeat", async () => {
    const created = await store();

    const first = await del(created.id);
    expect(first.status).toBe(204);
    await expect(first.text()).resolves.toBe("");

    const second = await del(created.id);
    expect(second.status).toBe(404);
  });

  it("returns 404 for a malformed id", async () => {
    const response = await del("nope");
    expect(response.status).toBe(404);
  });
});

describe("authentication", () => {
  const EXPECTED = { error: "צריך להתחבר כדי לשנות משהו כאן" };

  it.each([
    ["no cookie at all", null],
    ["a garbage cookie", "zitutim_session=not-a-jwt"],
    ["an unrelated cookie", "theme=light"],
  ])("rejects POST with %s", async (_label, cookie) => {
    const response = await post(body(), cookie);

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual(EXPECTED);

    const db = await getDb();
    await expect(db.collection("quotes").countDocuments()).resolves.toBe(0);
  });

  it("rejects PUT and DELETE without a session", async () => {
    const created = await store();

    expect((await put(created.id, body({ text: "חטיפה" }), null)).status).toBe(
      401,
    );
    expect((await del(created.id, null)).status).toBe(401);

    // And nothing happened.
    await expect(
      GET_ONE(new Request(`${BASE}/${created.id}`), params(created.id)).then(
        (r) => r.json(),
      ),
    ).resolves.toMatchObject({ text: body().text });
  });

  it("rejects an expired session", async () => {
    const { signSession } = await import("@/lib/session");
    const longAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const { token } = await signSession(TEST_USER, longAgo);

    const response = await post(body(), `zitutim_session=${token}`);
    expect(response.status).toBe(401);
  });

  it("answers 401 before validation, so anonymous callers learn nothing", async () => {
    // A malformed body with no session must not reveal the validation rules.
    const response = await post(body({ author: "" }), null);
    expect(response.status).toBe(401);

    const malformed = await post("{not json", null);
    expect(malformed.status).toBe(401);
  });

  it("rejects a cross-origin POST even with a valid session", async () => {
    // SameSite=Lax already covers most of this; the Origin check is the belt.
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
    await expect(db.collection("quotes").countDocuments()).resolves.toBe(0);
  });

  it("rejects a cross-origin DELETE even with a valid session", async () => {
    const created = await store();

    const response = await DELETE(
      new Request(`${BASE}/${created.id}`, {
        method: "DELETE",
        headers: {
          cookie: await sessionCookie(),
          origin: "https://evil.example",
        },
      }),
      params(created.id),
    );

    expect(response.status).toBe(403);
    const db = await getDb();
    await expect(db.collection("quotes").countDocuments()).resolves.toBe(1);
  });

  it("keeps reads public", async () => {
    // The whole point of "public read, login to write": an anonymous visitor
    // must still be able to browse the wall.
    await store();

    const list = await GET(new Request(BASE));
    expect(list.status).toBe(200);
    await expect(list.json()).resolves.toMatchObject({ total: 1 });
  });

  it("records the editor without changing the original attribution", async () => {
    const created = await store();
    const other = { id: "6b0000000000000000000009", name: "עומר לוי" };
    const { signSession } = await import("@/lib/session");
    const { token } = await signSession({ ...other, username: "omer" });

    const response = await put(
      created.id,
      body({ text: "עומר עורך" }),
      `zitutim_session=${token}`,
    );

    const quote: Quote = await response.json();
    expect(quote.addedBy).toBe(TEST_USER.name);
    expect(quote.updatedBy).toBe("עומר לוי");
  });
});
