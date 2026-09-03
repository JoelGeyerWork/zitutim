import { describe, expect, it } from "vitest";

import { quoteInputSchema } from "@/lib/quote-schema";

const valid = {
  text: "תמיד יש זמן לעוד קפה אחד",
  // The form names a person rather than typing one wherever it can; a plain
  // name is the third arm, for a speaker the organisation cannot answer for.
  author: { source: "name", name: "דנה" },
  saidAt: "2026-07-28",
  context: "לפני הריטרו",
  addedBy: "יואל",
};

describe("quoteInputSchema", () => {
  it("accepts a complete quote", () => {
    const result = quoteInputSchema.safeParse(valid);
    expect(result.success).toBe(true);
  });

  it("trims whitespace off every text field", () => {
    const parsed = quoteInputSchema.parse({
      ...valid,
      text: "  יש רווחים  ",
      author: { source: "name", name: "  דנה  " },
    });
    expect(parsed.text).toBe("יש רווחים");
    expect(parsed.author).toEqual({ source: "name", name: "דנה" });
  });

  it.each([
    ["a users row", { source: "user", id: "6b0000000000000000000001" }],
    ["the directory", { source: "directory", id: "guid-roi" }],
  ])("accepts a speaker picked out of %s", (_label, author) => {
    const parsed = quoteInputSchema.parse({ ...valid, author });
    expect(parsed.author).toEqual(author);
  });

  it("rejects a source it does not know", () => {
    // The tag is explicit rather than sniffed off the shape of the id, so an
    // unknown one is refused rather than guessed at.
    const result = quoteInputSchema.safeParse({
      ...valid,
      author: { source: "ldap", id: "guid-roi" },
    });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.path[0]).toBe("author");
  });

  it("normalises blank and missing optionals to null", () => {
    const parsed = quoteInputSchema.parse({
      text: valid.text,
      author: valid.author,
      saidAt: valid.saidAt,
      context: "   ",
    });
    expect(parsed.context).toBeNull();
  });

  it("strips a client-supplied addedBy rather than honouring it", () => {
    // Attribution comes from the session. If this key survived parsing, any
    // caller could post a quote under someone else's name.
    const parsed = quoteInputSchema.parse({ ...valid, addedBy: "מישהו אחר" });
    expect(parsed).not.toHaveProperty("addedBy");
  });

  it.each([
    ["empty text", { ...valid, text: "" }, "text"],
    ["whitespace-only text", { ...valid, text: "   " }, "text"],
    ["a missing author", { ...valid, author: undefined }, "author"],
    ["empty author", { ...valid, author: { source: "name", name: "" } }, "author"],
    ["text over 2000 chars", { ...valid, text: "א".repeat(2001) }, "text"],
    [
      "author over 120 chars",
      { ...valid, author: { source: "name", name: "א".repeat(121) } },
      "author",
    ],
    ["context over 400 chars", { ...valid, context: "א".repeat(401) }, "context"],
  ])("rejects %s", (_label, input, field) => {
    const result = quoteInputSchema.safeParse(input);
    expect(result.success).toBe(false);
    expect(result.error?.issues.map((issue) => issue.path[0])).toContain(field);
  });

  it.each([
    ["a non-ISO format", "28/07/2026"],
    ["a full timestamp", "2026-07-28T10:00:00Z"],
    ["a date that does not exist", "2026-02-31"],
    ["nonsense", "מחר"],
  ])("rejects %s as saidAt", (_label, saidAt) => {
    expect(quoteInputSchema.safeParse({ ...valid, saidAt }).success).toBe(false);
  });

  it("rejects a date in the future", () => {
    const nextYear = new Date();
    nextYear.setFullYear(nextYear.getFullYear() + 1);
    const result = quoteInputSchema.safeParse({
      ...valid,
      saidAt: nextYear.toISOString().slice(0, 10),
    });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toBe("התאריך בעתיד");
  });

  it("allows today, accounting for timezones ahead of UTC", () => {
    const today = new Date().toISOString().slice(0, 10);
    expect(quoteInputSchema.safeParse({ ...valid, saidAt: today }).success).toBe(
      true,
    );
  });

  it("reports errors in Hebrew", () => {
    const result = quoteInputSchema.safeParse({
      ...valid,
      author: { source: "name", name: "" },
    });
    expect(result.error?.issues[0]?.message).toBe("צריך לציין מי אמר");
  });
});
