import { ObjectId } from "mongodb";
import { beforeEach, describe, expect, it } from "vitest";

import { getDb } from "@/lib/mongodb";
import { type RotationDoc } from "@/lib/rotation";
import {
  createTheme,
  deleteTheme,
  getStandings,
  getTheme,
  getThemeStats,
  listThemes,
  resolveThemeMembers,
  updateTheme,
  type ResolvedMembers,
  type ThemeActor,
} from "@/lib/themes";
import type { ThemeValues } from "@/lib/theme-schema";

const ADDER: ThemeActor = { id: "6b0000000000000000000001", name: "יואל" };
const EDITOR: ThemeActor = { id: "6b0000000000000000000002", name: "נועה" };

/**
 * The roster the FK points at. `directoryId` matches `team.ts` ⇄ `directory.ts`
 * so `getThemeRoster()` (and therefore the standings) find these rows; the
 * two off-roster people at the end let us test an ex-member guesser.
 */
const ROSTER = [
  { directoryId: "8a1f0c2e-4d3b-4a91-9f70-1c2d3e4f5a01", displayName: "נועה ברקת" },
  { directoryId: "1c9d5b74-2e60-4f18-b3a2-7d51e0c48b12", displayName: "איתי שרון" },
  { directoryId: "b6740f31-8c25-4d0a-9e63-5a29d7fb1c33", displayName: "שירה לוי" },
  { directoryId: "3e82a5d0-77b9-4c46-8f11-6b0c94ae2d44", displayName: "דניאל עמר" },
  { directoryId: "d05c3971-1a4e-4b82-97d5-2f6738ec9a55", displayName: "תמר רוזן" },
  { directoryId: "77b1e2c8-9f30-4a57-8d24-3c81b05fa766", displayName: "יונתן כץ" },
  { directoryId: "a4390d16-5b72-4e93-b108-9d47c2e6f877", displayName: "מאיה גלעד" },
  { directoryId: "62fd8b40-3c19-4a75-9b86-0e5721da3c88", displayName: "אורי בן־חיים" },
];

/** Someone in the directory but off the rotation — a guesser who has left. */
const OFF_ROSTER = {
  directoryId: "0f47a6e3-8d51-4062-a9c7-4b3e18df5099",
  displayName: "רועי אשכנזי",
};

/**
 * Seed users, put the eight ROSTER members in the rotation document (the roster
 * `getThemeRoster` now reads), and return a name → users._id (hex) map. The
 * off-roster person is deliberately left out of the rotation — they only appear
 * in the standings through a theme snapshot, the way a departed guesser does.
 */
async function seedUsers(): Promise<Record<string, string>> {
  const db = await getDb();
  const now = new Date();
  const ids: Record<string, string> = {};
  for (const member of [...ROSTER, OFF_ROSTER]) {
    const result = await db.collection("users").insertOne({
      directoryId: member.directoryId,
      username: member.displayName,
      upn: null,
      displayName: member.displayName,
      title: "חבר צוות",
      mail: null,
      dn: `CN=${member.directoryId}`,
      createdAt: now,
      updatedAt: now,
      lastLoginAt: now,
    });
    ids[member.displayName] = result.insertedId.toHexString();
  }

  await db.collection<RotationDoc>("rotation").insertOne({
    _id: "current",
    members: ROSTER.map((member) => ({
      userId: new ObjectId(ids[member.displayName]),
      gender: "f" as const,
    })),
    updatedAt: now,
  });

  return ids;
}

let userId: Record<string, string>;

function input(overrides: Partial<ThemeValues> = {}): ThemeValues {
  return {
    date: "2026-08-18",
    broughtById: userId["נועה ברקת"],
    theme: "הכול עגול",
    snacks: ["בייגלה", "דונאטס"],
    guessedById: null,
    ...overrides,
  };
}

/** Resolve names the way the route does, then create — the real path. */
async function create(overrides: Partial<ThemeValues> = {}, actor = ADDER) {
  const values = input(overrides);
  const resolved = await resolveThemeMembers(values);
  if (!resolved.ok) throw new Error(`unresolved: ${JSON.stringify(resolved.issues)}`);
  return createTheme(values, resolved.members, actor);
}

beforeEach(async () => {
  const db = await getDb();
  await db.collection("themes").deleteMany({});
  await db.collection("users").deleteMany({});
  await db.collection("rotation").deleteMany({});
  // The memory-server never runs the seed, so indexes are whatever a prior test
  // created. Reset to none (bar `_id`) so the unique-date index is a per-test
  // opt-in — the tie-pagination test deliberately needs same-date rows.
  await db.collection("themes").dropIndexes();
  userId = await seedUsers();
});

describe("createTheme", () => {
  it("returns a serialized theme with string dates and the brought-by snapshot", async () => {
    const theme = await create();

    expect(theme.id).toMatch(/^[a-f0-9]{24}$/);
    expect(theme.theme).toBe("הכול עגול");
    expect(theme.broughtById).toBe(userId["נועה ברקת"]);
    expect(theme.broughtBy).toBe("נועה ברקת");
    expect(theme.guessedBy).toBeNull();
    expect(typeof theme.createdAt).toBe("string");
  });

  it("stamps addedBy from the actor, not from who brought or guessed it", async () => {
    const theme = await create({ broughtById: userId["איתי שרון"] });

    expect(theme.addedBy).toBe("יואל");
    expect(theme.addedById).toBe(ADDER.id);
    // The person who brought it is a different axis entirely.
    expect(theme.broughtBy).toBe("איתי שרון");
    expect(theme.updatedBy).toBeNull();
  });

  it("stores date at UTC midnight so the day cannot drift", async () => {
    const theme = await create({ date: "2026-08-18" });
    expect(theme.date).toBe("2026-08-18T00:00:00.000Z");
  });

  it("resolves the guesser's snapshot when solved", async () => {
    const theme = await create({ guessedById: userId["תמר רוזן"] });
    expect(theme.guessedById).toBe(userId["תמר רוזן"]);
    expect(theme.guessedBy).toBe("תמר רוזן");
  });

  it("rejects a duplicate date via the unique index, not a pre-check", async () => {
    // The unique index on `date` is created lazily in tests, so ensure it.
    const db = await getDb();
    await db.collection("themes").createIndex({ date: -1 }, { unique: true });

    await create({ date: "2026-08-18" });
    await expect(create({ date: "2026-08-18" })).rejects.toMatchObject({
      code: 11000,
    });
  });
});

describe("resolveThemeMembers", () => {
  it("rejects a broughtById that resolves to no user", async () => {
    const result = await resolveThemeMembers({
      broughtById: "0".repeat(24),
      guessedById: null,
    });
    expect(result).toMatchObject({ ok: false });
    if (!result.ok) expect(result.issues.broughtById).toBeTruthy();
  });

  it("rejects an unknown guessedById on that field", async () => {
    const result = await resolveThemeMembers({
      broughtById: userId["נועה ברקת"],
      guessedById: "0".repeat(24),
    });
    expect(result).toMatchObject({ ok: false });
    if (!result.ok) {
      expect(result.issues.guessedById).toBeTruthy();
      expect(result.issues.broughtById).toBeUndefined();
    }
  });

  it("does not store anything for an unknown member", async () => {
    // The route never reaches createTheme when resolution fails.
    const result = await resolveThemeMembers({
      broughtById: "0".repeat(24),
      guessedById: null,
    });
    expect(result.ok).toBe(false);
    const db = await getDb();
    await expect(db.collection("themes").countDocuments()).resolves.toBe(0);
  });
});

describe("getTheme", () => {
  it("returns null for a missing or malformed id", async () => {
    await expect(getTheme("0".repeat(24))).resolves.toBeNull();
    await expect(getTheme("not-an-object-id")).resolves.toBeNull();
  });
});

describe("updateTheme", () => {
  const members: ResolvedMembers = { broughtBy: "נועה ברקת", guessedBy: null };

  it("applies the change and records the editor", async () => {
    const created = await create();
    const updated = await updateTheme(
      created.id,
      input({ theme: "ניסוח מתוקן" }),
      { broughtBy: "נועה ברקת", guessedBy: null },
      EDITOR,
    );

    expect(updated?.theme).toBe("ניסוח מתוקן");
    expect(updated?.createdAt).toBe(created.createdAt);
    expect(updated?.updatedBy).toBe("נועה");
    expect(updated?.updatedById).toBe(EDITOR.id);
  });

  it("never rewrites broughtBy or addedBy with the editor", async () => {
    // Mirror of the updateQuote authorship test: an edit by someone else must
    // not transfer the "brought it" or "logged it" credit.
    const created = await create({}, ADDER); // added by יואל, brought by נועה ברקת

    const updated = await updateTheme(
      created.id,
      input({ theme: "נועה עורכת" }),
      members,
      EDITOR,
    );

    expect(updated?.addedBy).toBe("יואל");
    expect(updated?.addedById).toBe(ADDER.id);
    expect(updated?.broughtBy).toBe("נועה ברקת");
    expect(updated?.updatedBy).toBe("נועה");
  });

  it("returns null for a missing or malformed id", async () => {
    await expect(
      updateTheme("0".repeat(24), input(), members, EDITOR),
    ).resolves.toBeNull();
    await expect(
      updateTheme("nope", input(), members, EDITOR),
    ).resolves.toBeNull();
  });
});

describe("deleteTheme", () => {
  it("removes the theme and reports success once", async () => {
    const created = await create();
    await expect(deleteTheme(created.id)).resolves.toBe(true);
    await expect(getTheme(created.id)).resolves.toBeNull();
    await expect(deleteTheme(created.id)).resolves.toBe(false);
  });

  it("returns false for a malformed id", async () => {
    await expect(deleteTheme("nope")).resolves.toBe(false);
  });
});

describe("listThemes", () => {
  it("orders newest date first and reports the total", async () => {
    await create({ date: "2026-06-09" });
    await create({ date: "2026-08-18" });
    await create({ date: "2026-07-14" });

    const page = await listThemes();
    expect(page.themes.map((theme) => theme.date)).toEqual([
      "2026-08-18T00:00:00.000Z",
      "2026-07-14T00:00:00.000Z",
      "2026-06-09T00:00:00.000Z",
    ]);
    expect(page.total).toBe(3);
    expect(page.hasMore).toBe(false);
  });

  it("paginates without gaps or repeats when dates tie", async () => {
    // Same date on every row: the only thing keeping paging stable is the `_id`
    // tiebreak in the sort spec.
    const db = await getDb();
    const brought = new ObjectId(userId["נועה ברקת"]);
    await db.collection("themes").insertMany(
      Array.from({ length: 9 }, (_, index) => ({
        date: new Date("2026-08-18"),
        broughtById: brought,
        broughtBy: "נועה ברקת",
        theme: `נושא ${index}`,
        snacks: [],
        guessedById: null,
        guessedBy: null,
        addedBy: null,
        addedById: null,
        updatedBy: null,
        updatedById: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      })),
    );

    const seen: string[] = [];
    for (let skip = 0; skip < 9; skip += 2) {
      const page = await listThemes({ skip, limit: 2 });
      seen.push(...page.themes.map((theme) => theme.id));
    }
    expect(new Set(seen).size).toBe(9);
  });

  it("searches the theme text", async () => {
    await create({ date: "2026-08-18", theme: "הכול עגול" });
    await create({ date: "2026-08-11", theme: "מקסיקו" });

    const page = await listThemes({ search: "מקסיקו" });
    expect(page.themes).toHaveLength(1);
    expect(page.themes[0].theme).toBe("מקסיקו");
    expect(page.total).toBe(1);
  });

  it.each([
    ["snacks", "דונאטס"],
    ["broughtBy", "נועה"],
    ["guessedBy", "תמר"],
  ])("searches %s too", async (_field, term) => {
    await create({
      date: "2026-08-18",
      theme: "הכול עגול",
      snacks: ["בייגלה", "דונאטס"],
      guessedById: userId["תמר רוזן"],
    });
    await create({
      date: "2026-08-11",
      theme: "מקסיקו",
      snacks: ["נאצ׳וס"],
      broughtById: userId["אורי בן־חיים"],
    });

    const page = await listThemes({ search: term });
    expect(page.themes).toHaveLength(1);
    expect(page.themes[0].theme).toBe("הכול עגול");
  });

  it("ignores case", async () => {
    await create({ date: "2026-08-18", theme: "Mexico" });
    const page = await listThemes({ search: "mexico" });
    expect(page.themes.map((theme) => theme.theme)).toEqual(["Mexico"]);
  });

  it("treats regex metacharacters as literal text", async () => {
    // Unescaped, ".*" would match every theme in the collection.
    await create({ date: "2026-08-18", theme: "הכול עגול" });
    const page = await listThemes({ search: ".*" });
    expect(page.total).toBe(0);

    await create({ date: "2026-08-11", theme: "אמר .* בכוונה" });
    await expect(listThemes({ search: ".*" })).resolves.toMatchObject({
      total: 1,
    });
  });

  it("trims the search term and ignores a blank one", async () => {
    await create({ date: "2026-08-18", theme: "הכול עגול" });
    await create({ date: "2026-08-11", theme: "מקסיקו" });

    await expect(listThemes({ search: "  מקסיקו  " })).resolves.toMatchObject({
      total: 1,
    });
    await expect(listThemes({ search: "   " })).resolves.toMatchObject({
      total: 2,
    });
  });
});

describe("getThemeStats", () => {
  it("counts total and solved themes", async () => {
    await create({ date: "2026-08-18", guessedById: userId["תמר רוזן"] });
    await create({ date: "2026-08-11", guessedById: null });

    await expect(getThemeStats()).resolves.toEqual({ total: 2, solved: 1 });
  });
});

describe("getStandings", () => {
  it("ranks by guesses, with every roster member present even at zero", async () => {
    await create({ date: "2026-08-18", guessedById: userId["תמר רוזן"] });
    await create({ date: "2026-08-11", guessedById: userId["תמר רוזן"] });
    await create({ date: "2026-08-04", guessedById: userId["מאיה גלעד"] });

    const board = await getStandings();

    // All eight roster members are on the board.
    expect(board).toHaveLength(8);
    expect(board[0]).toMatchObject({ name: "תמר רוזן", guesses: 2 });
    expect(board[1]).toMatchObject({ name: "מאיה גלעד", guesses: 1 });
    // The rest are present on zero.
    expect(board.filter((row) => row.guesses === 0)).toHaveLength(6);
  });

  it("breaks ties on the most-recent guess, not the alphabet", async () => {
    await create({ date: "2026-08-18", guessedById: userId["נועה ברקת"] });
    await create({ date: "2026-08-11", guessedById: userId["אורי בן־חיים"] });

    const board = await getStandings();
    // Both on one guess; נועה's is newer, so she leads.
    expect(board[0]).toMatchObject({ name: "נועה ברקת", guesses: 1 });
    expect(board[1]).toMatchObject({ name: "אורי בן־חיים", guesses: 1 });
  });

  it("keeps shared places for equal scores", async () => {
    await create({ date: "2026-08-18", guessedById: userId["נועה ברקת"] });
    await create({ date: "2026-08-11", guessedById: userId["איתי שרון"] });

    const board = await getStandings();
    const { placeOf } = await import("@/lib/theme-schema");
    // Two leaders on one guess are both 1st; the first zero is 3rd.
    expect(placeOf(board, 0)).toBe(1);
    expect(placeOf(board, 1)).toBe(1);
    expect(placeOf(board, 2)).toBe(3);
  });

  it("still counts a guesser who has left the roster", async () => {
    await create({ date: "2026-08-18", guessedById: userId["רועי אשכנזי"] });

    const board = await getStandings();
    const roi = board.find((row) => row.name === "רועי אשכנזי");
    expect(roi).toMatchObject({ guesses: 1, role: null });
    // Eight roster members plus the one ex-member.
    expect(board).toHaveLength(9);
  });
});
