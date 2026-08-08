import { beforeEach, describe, expect, it } from "vitest";

import { getDb } from "@/lib/mongodb";
import {
  createQuote,
  deleteQuote,
  getQuote,
  getStats,
  listQuotes,
  updateQuote,
} from "@/lib/quotes";
import type { QuoteValues } from "@/lib/quote-schema";

function input(overrides: Partial<QuoteValues> = {}): QuoteValues {
  return {
    text: "תמיד יש זמן לעוד קפה אחד",
    author: "דנה",
    saidAt: "2026-07-28",
    context: null,
    addedBy: null,
    ...overrides,
  };
}

beforeEach(async () => {
  const db = await getDb();
  await db.collection("quotes").deleteMany({});
});

describe("createQuote", () => {
  it("returns a serialized quote with string dates", async () => {
    const quote = await createQuote(input({ context: "לפני הריטרו" }));

    expect(quote.id).toMatch(/^[a-f0-9]{24}$/);
    expect(quote.text).toBe("תמיד יש זמן לעוד קפה אחד");
    expect(quote.context).toBe("לפני הריטרו");
    expect(quote.addedBy).toBeNull();
    expect(typeof quote.createdAt).toBe("string");
  });

  it("stores saidAt at UTC midnight so the day cannot drift", async () => {
    const quote = await createQuote(input({ saidAt: "2026-07-28" }));
    expect(quote.saidAt).toBe("2026-07-28T00:00:00.000Z");
  });

  it("persists the quote so it can be read back", async () => {
    const created = await createQuote(input());
    await expect(getQuote(created.id)).resolves.toMatchObject({
      id: created.id,
      text: created.text,
    });
  });
});

describe("getQuote", () => {
  it("returns null for an id that does not exist", async () => {
    await expect(getQuote("0".repeat(24))).resolves.toBeNull();
  });

  it("returns null for a malformed id instead of throwing", async () => {
    await expect(getQuote("not-an-object-id")).resolves.toBeNull();
  });
});

describe("updateQuote", () => {
  it("applies the change and bumps updatedAt", async () => {
    const created = await createQuote(input());
    const updated = await updateQuote(
      created.id,
      input({ text: "ניסוח מתוקן", addedBy: "יואל" }),
    );

    expect(updated?.text).toBe("ניסוח מתוקן");
    expect(updated?.addedBy).toBe("יואל");
    expect(updated?.createdAt).toBe(created.createdAt);
    expect(
      new Date(updated!.updatedAt).getTime(),
    ).toBeGreaterThanOrEqual(new Date(created.updatedAt).getTime());
  });

  it("can clear an optional field back to null", async () => {
    const created = await createQuote(input({ context: "היה הקשר" }));
    const updated = await updateQuote(created.id, input({ context: null }));
    expect(updated?.context).toBeNull();
  });

  it("returns null for a missing or malformed id", async () => {
    await expect(updateQuote("0".repeat(24), input())).resolves.toBeNull();
    await expect(updateQuote("nope", input())).resolves.toBeNull();
  });
});

describe("deleteQuote", () => {
  it("removes the quote and reports success once", async () => {
    const created = await createQuote(input());

    await expect(deleteQuote(created.id)).resolves.toBe(true);
    await expect(getQuote(created.id)).resolves.toBeNull();
    await expect(deleteQuote(created.id)).resolves.toBe(false);
  });

  it("returns false for a malformed id", async () => {
    await expect(deleteQuote("nope")).resolves.toBe(false);
  });
});

describe("listQuotes", () => {
  beforeEach(async () => {
    // Created oldest-first, so "added" order is the reverse of this array.
    await createQuote(input({ author: "דנה", saidAt: "2026-01-10" }));
    await createQuote(
      input({ author: "עומר", saidAt: "2026-05-02", text: "בואו נדחה את זה" }),
    );
    await createQuote(
      input({
        author: "איתי",
        saidAt: "2026-03-20",
        text: "אין דבר קבוע יותר מפיצ׳ר זמני",
        context: "בקוד רוויו",
        addedBy: "נועה",
      }),
    );
  });

  it("defaults to newest-added first", async () => {
    const page = await listQuotes();
    expect(page.quotes.map((quote) => quote.author)).toEqual([
      "איתי",
      "עומר",
      "דנה",
    ]);
    expect(page.total).toBe(3);
    expect(page.hasMore).toBe(false);
  });

  it.each([
    ["recent", ["עומר", "איתי", "דנה"]],
    ["oldest", ["דנה", "איתי", "עומר"]],
    ["author", ["איתי", "דנה", "עומר"]],
  ] as const)("sorts by %s", async (sort, expected) => {
    const page = await listQuotes({ sort });
    expect(page.quotes.map((quote) => quote.author)).toEqual(expected);
  });

  it("searches the quote text", async () => {
    const page = await listQuotes({ search: "נדחה" });
    expect(page.quotes).toHaveLength(1);
    expect(page.quotes[0].author).toBe("עומר");
  });

  it.each([
    ["author", "איתי"],
    ["context", "רוויו"],
    ["addedBy", "נועה"],
  ])("searches %s too", async (_field, term) => {
    const page = await listQuotes({ search: term });
    expect(page.quotes).toHaveLength(1);
    expect(page.quotes[0].author).toBe("איתי");
  });

  it("ignores case", async () => {
    await createQuote(input({ author: "Noa", text: "Ship it" }));
    const page = await listQuotes({ search: "ship" });
    expect(page.quotes.map((quote) => quote.author)).toEqual(["Noa"]);
  });

  it("treats regex metacharacters as literal text", async () => {
    // Unescaped, ".*" would match every quote in the collection.
    const page = await listQuotes({ search: ".*" });
    expect(page.total).toBe(0);

    await createQuote(input({ text: "אמר .* בכוונה" }));
    await expect(listQuotes({ search: ".*" })).resolves.toMatchObject({
      total: 1,
    });
  });

  it("trims the search term and ignores a blank one", async () => {
    await expect(listQuotes({ search: "  נדחה  " })).resolves.toMatchObject({
      total: 1,
    });
    await expect(listQuotes({ search: "   " })).resolves.toMatchObject({
      total: 3,
    });
  });

  it("returns an empty page when nothing matches", async () => {
    const page = await listQuotes({ search: "אין דבר כזה" });
    expect(page).toMatchObject({ quotes: [], total: 0, hasMore: false });
  });

  it("paginates with skip and limit, reporting the unpaged total", async () => {
    const first = await listQuotes({ limit: 2 });
    expect(first.quotes).toHaveLength(2);
    expect(first.total).toBe(3);
    expect(first.hasMore).toBe(true);

    const second = await listQuotes({ skip: 2, limit: 2 });
    expect(second.quotes).toHaveLength(1);
    expect(second.hasMore).toBe(false);

    const ids = [...first.quotes, ...second.quotes].map((quote) => quote.id);
    expect(new Set(ids).size).toBe(3);
  });

  it("counts matches, not the page, when searching", async () => {
    await createQuote(input({ author: "נועה" })); // second quote mentioning קפה

    const page = await listQuotes({ search: "קפה", limit: 1 });
    expect(page.quotes).toHaveLength(1);
    expect(page.total).toBe(2);
    expect(page.hasMore).toBe(true);
  });

  it("paginates without gaps or repeats when quotes tie", async () => {
    // Same author and same day, inserted back to back: everything the sort
    // keys can tie on, ties. Paging must still cover each quote exactly once.
    const db = await getDb();
    await db.collection("quotes").deleteMany({});
    const createdAt = new Date("2026-08-01T10:00:00.000Z");
    await db.collection("quotes").insertMany(
      Array.from({ length: 9 }, (_, index) => ({
        text: `ציטוט ${index}`,
        author: "דנה",
        saidAt: new Date("2026-07-28"),
        context: null,
        addedBy: null,
        createdAt,
        updatedAt: createdAt,
      })),
    );

    for (const sort of ["added", "recent", "oldest", "author"] as const) {
      const seen: string[] = [];
      for (let skip = 0; skip < 9; skip += 2) {
        const page = await listQuotes({ sort, skip, limit: 2 });
        seen.push(...page.quotes.map((quote) => quote.text));
      }
      expect(new Set(seen).size, `sort=${sort}`).toBe(9);
    }
  });

  it("caps limit at 100 and floors skip at 0", async () => {
    await expect(listQuotes({ limit: 5000 })).resolves.toMatchObject({
      total: 3,
    });
    await expect(listQuotes({ skip: -10 })).resolves.toMatchObject({
      hasMore: false,
    });
  });

  it("falls back to the default sort for an unknown value", async () => {
    const page = await listQuotes({
      sort: "bogus" as unknown as "added",
    });
    expect(page.quotes.map((quote) => quote.author)).toEqual([
      "איתי",
      "עומר",
      "דנה",
    ]);
  });
});

describe("getStats", () => {
  it("reports zeroes for an empty wall", async () => {
    await expect(getStats()).resolves.toEqual({
      total: 0,
      authors: 0,
      topAuthor: null,
    });
  });

  it("counts quotes, distinct authors and the leader", async () => {
    await createQuote(input({ author: "דנה" }));
    await createQuote(input({ author: "דנה" }));
    await createQuote(input({ author: "עומר" }));

    await expect(getStats()).resolves.toEqual({
      total: 3,
      authors: 2,
      topAuthor: { author: "דנה", count: 2 },
    });
  });

  it("breaks a tie deterministically", async () => {
    await createQuote(input({ author: "עומר" }));
    await createQuote(input({ author: "איתי" }));

    const stats = await getStats();
    expect(stats.topAuthor?.count).toBe(1);
    expect(stats.topAuthor?.author).toBe("איתי");
  });
});
