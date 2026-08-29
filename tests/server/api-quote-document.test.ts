import { beforeEach, describe, expect, it } from "vitest";

import { GET } from "@/app/api/quotes/[id]/document/route";
import { getDb } from "@/lib/mongodb";
import { createQuote, type QuoteActor } from "@/lib/quotes";
import type { QuoteValues } from "@/lib/quote-schema";
import { TEST_USER } from "./factories";

const ACTOR: QuoteActor = { id: TEST_USER.id, name: TEST_USER.name };

function input(overrides: Partial<QuoteValues> = {}): QuoteValues {
  return {
    text: "תמיד יש זמן לעוד קפה אחד",
    author: "דנה",
    saidAt: "2026-07-28",
    context: null,
    ...overrides,
  };
}

function get(id: string) {
  return GET(new Request(`http://localhost:3000/api/quotes/${id}/document`), {
    params: Promise.resolve({ id }),
  });
}

beforeEach(async () => {
  const db = await getDb();
  await db.collection("quotes").deleteMany({});
});

describe("GET /api/quotes/[id]/document", () => {
  it("serves the quote as a downloadable HTML document", async () => {
    const quote = await createQuote(input(), ACTOR);

    const response = await get(quote.id);
    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe(
      "text/html; charset=utf-8",
    );

    const html = await response.text();
    expect(html.startsWith("<!doctype html>")).toBe(true);
    expect(html).toContain("תמיד יש זמן לעוד קפה אחד");
  });

  it("answers without a session, like every other GET here", async () => {
    const quote = await createQuote(input(), ACTOR);

    // No cookie on the request at all.
    expect((await get(quote.id)).status).toBe(200);
  });

  it("offers a UTF-8 filename with an ASCII fallback", async () => {
    const quote = await createQuote(input(), ACTOR);

    const disposition = (await get(quote.id)).headers.get(
      "Content-Disposition",
    );

    expect(disposition).toContain("attachment");
    // The fallback is what a parser that ignores RFC 5987 reads, so it must be
    // pure ASCII rather than a mangled transliteration.
    expect(disposition).toContain('filename="quote.html"');
    expect(disposition).toContain(
      `filename*=UTF-8''${encodeURIComponent("ציטוט - דנה.html")}`,
    );
  });

  it("never lets an author's name break the header", async () => {
    const quote = await createQuote(
      input({ author: "דנה\r\nX-Injected: yes" }),
      ACTOR,
    );

    const disposition =
      (await get(quote.id)).headers.get("Content-Disposition") ?? "";

    // The name itself may legitimately survive into the filename; what must
    // not survive is the line break that would start a second header.
    expect(disposition).not.toMatch(/[\r\n]/);
    expect(disposition.split("\n")).toHaveLength(1);
  });

  it("is not cached, since a quote can be edited", async () => {
    const quote = await createQuote(input(), ACTOR);

    expect((await get(quote.id)).headers.get("Cache-Control")).toBe("no-store");
  });

  it("404s for a missing quote", async () => {
    const response = await get("6b0000000000000000000009");
    expect(response.status).toBe(404);
  });

  it("404s for an id that is not an ObjectId", async () => {
    const response = await get("not-an-id");
    expect(response.status).toBe(404);
  });
});
