import { beforeEach, describe, expect, it } from "vitest";

import { GET, POST } from "@/app/api/quotes/route";
import {
  DELETE,
  GET as GET_ONE,
  PUT,
} from "@/app/api/quotes/[id]/route";
import { getDb } from "@/lib/mongodb";
import { createQuote, type QuoteActor } from "@/lib/quotes";
import type { Quote, QuotePage, QuoteValues } from "@/lib/quote-schema";
import { TEST_USER, sessionCookie } from "./factories";

const BASE = "http://localhost:3000/api/quotes";

const ACTOR: QuoteActor = { id: TEST_USER.id, name: TEST_USER.name };

function body(overrides: Record<string, unknown> = {}) {
  return {
    text: "תמיד יש זמן לעוד קפה אחד",
    author: "דנה",
    saidAt: "2026-07-28",
    context: null,
    ...overrides,
  };
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
});

describe("POST /api/quotes", () => {
  it("creates a quote and returns 201 with the saved record", async () => {
    const response = await post(body());
    expect(response.status).toBe(201);

    const quote: Quote = await response.json();
    expect(quote.id).toMatch(/^[a-f0-9]{24}$/);
    expect(quote.author).toBe("דנה");
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

describe("GET /api/quotes", () => {
  beforeEach(async () => {
    await createQuote(body({ author: "דנה" }) as QuoteValues, ACTOR);
    await createQuote(
      body({ author: "עומר", text: "בואו נדחה את זה" }) as QuoteValues,
      ACTOR,
    );
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
    const created = await createQuote(body() as QuoteValues, ACTOR);
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
    const created = await createQuote(body() as QuoteValues, ACTOR);
    const response = await put(created.id, body({ text: "ניסוח מתוקן" }));

    expect(response.status).toBe(200);
    const quote: Quote = await response.json();
    expect(quote.text).toBe("ניסוח מתוקן");
    expect(quote.createdAt).toBe(created.createdAt);
  });

  it("returns 422 for invalid input", async () => {
    const created = await createQuote(body() as QuoteValues, ACTOR);
    const response = await put(created.id, body({ text: "" }));
    expect(response.status).toBe(422);
  });

  it("returns 400 for a malformed body", async () => {
    const created = await createQuote(body() as QuoteValues, ACTOR);
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
    const created = await createQuote(body() as QuoteValues, ACTOR);

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
    const created = await createQuote(body() as QuoteValues, ACTOR);

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
    const created = await createQuote(body() as QuoteValues, ACTOR);

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
    await createQuote(body() as QuoteValues, ACTOR);

    const list = await GET(new Request(BASE));
    expect(list.status).toBe(200);
    await expect(list.json()).resolves.toMatchObject({ total: 1 });
  });

  it("records the editor without changing the original attribution", async () => {
    const created = await createQuote(body() as QuoteValues, ACTOR);
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
