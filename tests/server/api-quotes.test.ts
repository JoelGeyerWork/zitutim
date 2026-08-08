import { beforeEach, describe, expect, it } from "vitest";

import { GET, POST } from "@/app/api/quotes/route";
import {
  DELETE,
  GET as GET_ONE,
  PUT,
} from "@/app/api/quotes/[id]/route";
import { getDb } from "@/lib/mongodb";
import { createQuote } from "@/lib/quotes";
import type { Quote, QuotePage, QuoteValues } from "@/lib/quote-schema";

const BASE = "http://localhost:3000/api/quotes";

function body(overrides: Record<string, unknown> = {}) {
  return {
    text: "תמיד יש זמן לעוד קפה אחד",
    author: "דנה",
    saidAt: "2026-07-28",
    context: null,
    addedBy: null,
    ...overrides,
  };
}

function post(payload: unknown) {
  return POST(
    new Request(BASE, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: typeof payload === "string" ? payload : JSON.stringify(payload),
    }),
  );
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
    const response = await post(body({ addedBy: "יואל" }));
    expect(response.status).toBe(201);

    const quote: Quote = await response.json();
    expect(quote.id).toMatch(/^[a-f0-9]{24}$/);
    expect(quote.author).toBe("דנה");
    expect(quote.addedBy).toBe("יואל");
    expect(quote.saidAt).toBe("2026-07-28T00:00:00.000Z");
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
    await createQuote(body({ author: "דנה" }) as QuoteValues);
    await createQuote(
      body({ author: "עומר", text: "בואו נדחה את זה" }) as QuoteValues,
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
    const created = await createQuote(body() as QuoteValues);
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

describe("PUT /api/quotes/:id", () => {
  function put(id: string, payload: unknown) {
    return PUT(
      new Request(`${BASE}/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: typeof payload === "string" ? payload : JSON.stringify(payload),
      }),
      params(id),
    );
  }

  it("replaces the quote and returns the updated record", async () => {
    const created = await createQuote(body() as QuoteValues);
    const response = await put(created.id, body({ text: "ניסוח מתוקן" }));

    expect(response.status).toBe(200);
    const quote: Quote = await response.json();
    expect(quote.text).toBe("ניסוח מתוקן");
    expect(quote.createdAt).toBe(created.createdAt);
  });

  it("returns 422 for invalid input", async () => {
    const created = await createQuote(body() as QuoteValues);
    const response = await put(created.id, body({ text: "" }));
    expect(response.status).toBe(422);
  });

  it("returns 400 for a malformed body", async () => {
    const created = await createQuote(body() as QuoteValues);
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
    const created = await createQuote(body() as QuoteValues);

    const first = await DELETE(new Request(BASE), params(created.id));
    expect(first.status).toBe(204);
    await expect(first.text()).resolves.toBe("");

    const second = await DELETE(new Request(BASE), params(created.id));
    expect(second.status).toBe(404);
  });

  it("returns 404 for a malformed id", async () => {
    const response = await DELETE(new Request(BASE), params("nope"));
    expect(response.status).toBe(404);
  });
});
