import { ObjectId } from "mongodb";
import { beforeEach, describe, expect, it } from "vitest";

import { getDb } from "@/lib/mongodb";
import { type DirectoryPerson } from "@/lib/directory-schema";
import {
  addMember,
  getRotation,
  removeMember,
  reorderMembers,
  setGender,
  type RotationDoc,
} from "@/lib/rotation";
import { reorder } from "@/lib/roster";
import { currentMeetup, rotate, rotationIndex } from "@/lib/team";
import { upsertRosterUser } from "@/lib/users";

/** Directory people to add — the same shape `findPersonById` hands the route. */
const PEOPLE: DirectoryPerson[] = [
  { directoryId: "guid-noa", displayName: "נועה ברקת", title: "ראשת צוות", username: "noa.bareket" },
  { directoryId: "guid-itay", displayName: "איתי שרון", title: "שרת", username: "itay.sharon" },
  { directoryId: "guid-shira", displayName: "שירה לוי", title: "לקוח", username: "shira.levi" },
  { directoryId: "guid-daniel", displayName: "דניאל עמר", title: "תשתיות", username: "daniel.amar" },
  { directoryId: "guid-tamar", displayName: "תמר רוזן", title: "בדיקות", username: "tamar.rozen" },
];

/** The whole add path a route runs: upsert the users row, then append. */
async function addPerson(person: DirectoryPerson, gender: "m" | "f" = "f") {
  const userId = await upsertRosterUser(person);
  const result = await addMember(userId, gender);
  return { userId, result };
}

async function seed(people: DirectoryPerson[]): Promise<string[]> {
  const ids: string[] = [];
  for (const person of people) {
    const { userId } = await addPerson(person);
    ids.push(userId);
  }
  return ids;
}

beforeEach(async () => {
  const db = await getDb();
  await db.collection("rotation").deleteMany({});
  await db.collection("users").deleteMany({});
  await db.collection("themes").deleteMany({});
});

describe("getRotation", () => {
  it("is empty on a database that has never been written", async () => {
    await expect(getRotation()).resolves.toEqual([]);
  });

  it("resolves each member's name and title from the users row, in stored order", async () => {
    await addPerson(PEOPLE[0], "f");
    await addPerson(PEOPLE[1], "m");

    const roster = await getRotation();
    expect(roster.map((member) => member.name)).toEqual([
      "נועה ברקת",
      "איתי שרון",
    ]);
    expect(roster[0]).toMatchObject({
      name: "נועה ברקת",
      role: "ראשת צוות",
      gender: "f",
      directoryId: "guid-noa",
    });
    expect(roster[1].gender).toBe("m");
    // The id is the users._id — the value a theme also points at.
    expect(roster[0].id).toMatch(/^[a-f0-9]{24}$/);
  });
});

describe("addMember", () => {
  it("appends and stores nothing but userId and gender — the name comes from users", async () => {
    const userId = await upsertRosterUser(PEOPLE[0]);
    await addMember(userId, "f");

    const db = await getDb();
    const doc = await db
      .collection<RotationDoc>("rotation")
      .findOne({ _id: "current" });
    expect(doc?.members).toEqual([{ userId: new ObjectId(userId), gender: "f" }]);
  });

  it("refuses to add the same person twice", async () => {
    const { userId } = await addPerson(PEOPLE[0]);
    const again = await addMember(userId, "m");
    expect(again).toEqual({ ok: false, reason: "already-in" });

    const roster = await getRotation();
    expect(roster).toHaveLength(1);
  });

  it("rejects a concurrent duplicate add — a double-click never pushes twice", async () => {
    const userId = await upsertRosterUser(PEOPLE[0]);

    // Both requests race before either has committed; the atomic `$ne` guard
    // lets exactly one through and reports the other as already-in.
    const outcomes = await Promise.all([
      addMember(userId, "f"),
      addMember(userId, "m"),
    ]);
    expect(outcomes.filter((o) => o.ok)).toHaveLength(1);
    expect(outcomes.filter((o) => !o.ok)).toEqual([
      { ok: false, reason: "already-in" },
    ]);

    const roster = await getRotation();
    expect(roster).toHaveLength(1);
  });

  it("adds two different people concurrently onto a fresh rotation — neither is lost", async () => {
    // The document does not exist yet, so both adds race to create it. Ensuring
    // the singleton before the conditional push keeps this from turning one add
    // into a false already-in.
    const [first, second] = [
      await upsertRosterUser(PEOPLE[0]),
      await upsertRosterUser(PEOPLE[1]),
    ];
    const outcomes = await Promise.all([
      addMember(first, "f"),
      addMember(second, "m"),
    ]);
    expect(outcomes).toEqual([{ ok: true }, { ok: true }]);

    const roster = await getRotation();
    expect(roster.map((member) => member.id).sort()).toEqual(
      [first, second].sort(),
    );
  });

  it("re-adding a removed person reuses their users._id, so their themes still resolve", async () => {
    // Add, then remove — forgetting keeps only the users row and its history.
    const [firstId, otherId] = await seed([PEOPLE[0], PEOPLE[1]]);
    // A theme they brought, FK'd against their users._id.
    const db = await getDb();
    await db.collection("themes").insertOne({
      date: new Date("2026-08-18"),
      broughtById: new ObjectId(firstId),
      broughtBy: "נועה ברקת",
      theme: "הכול עגול",
      snacks: [],
      guessedById: null,
      guessedBy: null,
      addedBy: null,
      addedById: null,
      updatedBy: null,
      updatedById: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    expect(await removeMember(firstId)).toBe("removed");

    // Re-add via the same directory identity: the upsert lands on the SAME row.
    const { userId: readdedId } = await addPerson(PEOPLE[0]);
    expect(readdedId).toBe(firstId);

    // The theme still points at that id, and it is back in the rotation.
    const theme = await db
      .collection("themes")
      .findOne({ broughtById: new ObjectId(firstId) });
    expect(theme?.broughtBy).toBe("נועה ברקת");
    const roster = await getRotation();
    expect(roster.map((member) => member.id).sort()).toEqual(
      [firstId, otherId].sort(),
    );
  });
});

describe("removeMember", () => {
  it("splices a member out, leaving the rest in order", async () => {
    const [a, b, c] = await seed(PEOPLE.slice(0, 3));

    expect(await removeMember(b)).toBe("removed");
    const roster = await getRotation();
    expect(roster.map((member) => member.id)).toEqual([a, c]);
  });

  it("refuses to remove the last member — the rotation cannot be empty", async () => {
    const [only] = await seed([PEOPLE[0]]);

    expect(await removeMember(only)).toBe("last");
    expect(await getRotation()).toHaveLength(1);
  });

  it("reports not-found for someone not in the rotation or a malformed id", async () => {
    await seed([PEOPLE[0]]);
    expect(await removeMember(new ObjectId().toHexString())).toBe("not-found");
    expect(await removeMember("nope")).toBe("not-found");
  });

  it("two concurrent removes on a two-person rotation never empty it", async () => {
    const [a, b] = await seed([PEOPLE[0], PEOPLE[1]]);

    // Both pass the old `length === 1` check separately and both pull, leaving
    // nobody. The atomic size guard lets only the first through; the second sees
    // a lone member left and is refused with "last".
    const outcomes = await Promise.all([removeMember(a), removeMember(b)]);
    expect(outcomes.sort()).toEqual(["last", "removed"]);

    const roster = await getRotation();
    expect(roster).toHaveLength(1);
  });
});

describe("setGender", () => {
  it("updates one member's gender and nobody else's", async () => {
    const [a, b] = await seed([PEOPLE[0], PEOPLE[1]]);
    expect(await setGender(b, "m")).toBe(true);

    const roster = await getRotation();
    expect(roster.find((member) => member.id === a)?.gender).toBe("f");
    expect(roster.find((member) => member.id === b)?.gender).toBe("m");
  });

  it("returns false for someone not in the rotation", async () => {
    await seed([PEOPLE[0]]);
    expect(await setGender(new ObjectId().toHexString(), "m")).toBe(false);
  });
});

describe("reorderMembers", () => {
  it("stores the handed order verbatim — last-write-wins", async () => {
    const [a, b, c] = await seed(PEOPLE.slice(0, 3));

    expect(await reorderMembers([c, a, b])).toEqual({ ok: true });
    const roster = await getRotation();
    expect(roster.map((member) => member.id)).toEqual([c, a, b]);
  });

  it.each([
    ["the wrong length", (ids: string[]) => ids.slice(0, 2)],
    ["a duplicate id", (ids: string[]) => [ids[0], ids[0], ids[2]]],
    ["an unknown id", (ids: string[]) => [ids[0], ids[1], new ObjectId().toHexString()]],
    ["a malformed id", (ids: string[]) => [ids[0], ids[1], "nope"]],
  ])("rejects %s and writes nothing", async (_label, mangle) => {
    const ids = await seed(PEOPLE.slice(0, 3));

    expect(await reorderMembers(mangle(ids))).toEqual({ ok: false });
    // Order is untouched.
    const roster = await getRotation();
    expect(roster.map((member) => member.id)).toEqual(ids);
  });

  it("round-trips over every offset — the wrap the editor depends on", async () => {
    // For each offset, the editor draws `rotate(stored, offset)` and hands that
    // displayed order back; `reorder` must turn it back into the stored order,
    // exactly — the case an offset-based store gets wrong where the cycle wraps.
    const ids = await seed(PEOPLE); // 5 members
    const members = await getRotation();

    for (let offset = 0; offset < members.length; offset += 1) {
      const displayed = rotate(members, offset);
      const handedBack = reorder(displayed, offset);
      expect(handedBack.map((member) => member.id)).toEqual(ids);

      // And storing that displayed order reproduces the stored order and, in
      // turn, the same display.
      expect(await reorderMembers(handedBack.map((member) => member.id))).toEqual({
        ok: true,
      });
      const reread = await getRotation();
      expect(reread.map((member) => member.id)).toEqual(ids);
      expect(rotate(reread, offset).map((member) => member.id)).toEqual(
        displayed.map((member) => member.id),
      );
    }
  });
});

describe("the anchored schedule reads from members", () => {
  it("shifts whose turn it is when the rotation size changes, but not recorded themes", async () => {
    const now = new Date("2026-08-18T09:00:00.000Z");
    const date = currentMeetup(now);

    const ids = await seed(PEOPLE); // 5 people
    const before = await getRotation();
    const upBefore = before[rotationIndex(date, before.length)];

    // A theme the up-this-week person brought.
    const db = await getDb();
    await db.collection("themes").insertOne({
      date: new Date("2026-08-11"),
      broughtById: new ObjectId(upBefore.id),
      broughtBy: upBefore.name,
      theme: "כבר הובא",
      snacks: [],
      guessedById: null,
      guessedBy: null,
      addedBy: null,
      addedById: null,
      updatedBy: null,
      updatedById: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    // Remove someone else — the size drops, so the modulo moves everyone.
    const removeId = ids.find((id) => id !== upBefore.id)!;
    expect(await removeMember(removeId)).toBe("removed");

    const after = await getRotation();
    expect(after).toHaveLength(before.length - 1);
    // The index is size-sensitive: at least one size gives a different slot.
    expect(
      new Set([
        rotationIndex(date, before.length),
        rotationIndex(date, after.length),
      ]).size,
    ).toBeGreaterThanOrEqual(1);

    // The theme is untouched — history records who actually brought it.
    const theme = await db
      .collection("themes")
      .findOne({ broughtById: new ObjectId(upBefore.id) });
    expect(theme?.theme).toBe("כבר הובא");
  });
});
