import { afterEach, describe, expect, it, vi } from "vitest";

import {
  authorTone,
  formatRelative,
  formatSaidAt,
  formatSaidAtShort,
  initial,
  plural,
  toInputValue,
  todayInputValue,
} from "@/lib/format";

afterEach(() => {
  vi.useRealTimers();
});

describe("formatSaidAt", () => {
  it("renders a Hebrew long date", () => {
    expect(formatSaidAt("2026-07-28T00:00:00.000Z")).toBe("28 ביולי 2026");
  });

  it("renders a short form too", () => {
    expect(formatSaidAtShort("2026-07-28T00:00:00.000Z")).toContain("2026");
  });

  it("keeps the stored day in timezones behind UTC", () => {
    // saidAt is stored at UTC midnight; formatting in local time would roll
    // this back to the 27th anywhere west of Greenwich.
    const original = process.env.TZ;
    process.env.TZ = "America/Los_Angeles";
    try {
      expect(formatSaidAt("2026-07-28T00:00:00.000Z")).toBe("28 ביולי 2026");
    } finally {
      process.env.TZ = original;
    }
  });
});

describe("formatRelative", () => {
  it.each([
    ["under a minute", 30 * 1000, "עכשיו"],
    ["hours", 5 * 60 * 60 * 1000, "לפני 5 שעות"],
    ["days", 3 * 24 * 60 * 60 * 1000, "לפני 3 ימים"],
  ])("describes %s in Hebrew", (_label, agoMs, expected) => {
    vi.useFakeTimers();
    const now = new Date("2026-08-08T12:00:00.000Z");
    vi.setSystemTime(now);
    expect(formatRelative(new Date(now.getTime() - agoMs).toISOString())).toBe(
      expected,
    );
  });
});

describe("plural", () => {
  it("uses the singular wording for one", () => {
    expect(plural(1, "תוצאה אחת", "תוצאות")).toBe("תוצאה אחת");
  });

  it.each([0, 2, 17])("prefixes the count for %i", (count) => {
    expect(plural(count, "תוצאה אחת", "תוצאות")).toBe(`${count} תוצאות`);
  });
});

describe("date input helpers", () => {
  it("produces a YYYY-MM-DD value for today", () => {
    expect(todayInputValue()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("uses the local day, not the UTC one", () => {
    vi.useFakeTimers();
    // 22:00 in Jerusalem (UTC+3) on the 8th is still 19:00 UTC on the 8th,
    // but at 02:00 local it would be the previous day in UTC.
    vi.setSystemTime(new Date("2026-08-08T23:30:00.000Z"));
    const value = todayInputValue();
    expect(value).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(new Date(value).getUTCDate()).toBe(new Date().getDate());
  });

  it("round-trips an ISO timestamp back to a date input value", () => {
    expect(toInputValue("2026-07-28T00:00:00.000Z")).toBe("2026-07-28");
  });
});

describe("avatar helpers", () => {
  it("takes the first letter of a name", () => {
    expect(initial("  דנה ")).toBe("ד");
    expect(initial("noa")).toBe("N");
  });

  it("falls back to a question mark for an empty name", () => {
    expect(initial("   ")).toBe("?");
  });

  it("gives the same author the same tone every time", () => {
    expect(authorTone("דנה")).toBe(authorTone("דנה"));
  });

  it("stays inside the palette range", () => {
    for (const name of ["דנה", "עומר", "נועה", "איתי", "רותם", ""]) {
      expect(authorTone(name)).toBeGreaterThanOrEqual(0);
      expect(authorTone(name)).toBeLessThan(5);
    }
  });
});
