import { ObjectId } from "mongodb";
import { beforeEach, describe, expect, it } from "vitest";

import { type DirectoryPerson } from "@/lib/directory-schema";
import { getDb } from "@/lib/mongodb";
import {
  addMember,
  getRotation,
  reorderMembers,
  type RotationDoc,
} from "@/lib/rotation";
import {
  addShotefMember,
  currentShift,
  getShotefRotation,
  removeShotefMember,
  reorderShotefMembers,
  setShotefGender,
  shiftIndex,
} from "@/lib/shotef";
import { upsertRosterUser } from "@/lib/users";

/**
 * The שוטף rotation shares `rotation.ts` with the ישב״צ one, keyed by `_id`.
 * What is worth testing here is therefore not the atomicity — `rotation.test.ts`
 * covers that against the default row — but that the key actually separates the
 * two: one rotation's writes must be invisible to the other.
 */
const PEOPLE: DirectoryPerson[] = [
  { directoryId: "guid-noa", displayName: "נועה ברקת", title: "ראשת צוות", username: "noa.bareket" },
  { directoryId: "guid-itay", displayName: "איתי שרון", title: "שרת", username: "itay.sharon" },
  { directoryId: "guid-shira", displayName: "שירה לוי", title: "לקוח", username: "shira.levi" },
];

async function addShotef(person: DirectoryPerson, gender: "m" | "f" = "f") {
  const userId = await upsertRosterUser(person);
  const result = await addShotefMember(userId, gender);
  return { userId, result };
}

async function seedShotef(people: DirectoryPerson[]): Promise<string[]> {
  const ids: string[] = [];
  for (const person of people) {
    const { userId } = await addShotef(person);
    ids.push(userId);
  }
  return ids;
}

beforeEach(async () => {
  const db = await getDb();
  await db.collection("rotation").deleteMany({});
  await db.collection("users").deleteMany({});
});

describe("the שוטף rotation is its own row", () => {
  it("stores under _id: shotef, leaving the meetup rotation alone", async () => {
    const { userId } = await addShotef(PEOPLE[0], "f");

    const db = await getDb();
    const doc = await db
      .collection<RotationDoc>("rotation")
      .findOne({ _id: "shotef" });
    expect(doc?.members).toEqual([{ userId: new ObjectId(userId), gender: "f" }]);

    // The default row was never created — one write, one document.
    await expect(
      db.collection<RotationDoc>("rotation").findOne({ _id: "current" }),
    ).resolves.toBeNull();
    await expect(getRotation()).resolves.toEqual([]);
  });

  it("lets the same person sit in both rotations, on one users row", async () => {
    const userId = await upsertRosterUser(PEOPLE[0]);
    expect(await addMember(userId, "f")).toEqual({ ok: true });
    expect(await addShotefMember(userId, "f")).toEqual({ ok: true });

    // Membership is per rotation; identity is the single `users` row both name.
    const [meetup, shotef] = [await getRotation(), await getShotefRotation()];
    expect(meetup.map((member) => member.id)).toEqual([userId]);
    expect(shotef.map((member) => member.id)).toEqual([userId]);

    const db = await getDb();
    await expect(db.collection("users").countDocuments()).resolves.toBe(1);
  });

  it("resolves names and titles from users, in stored order", async () => {
    await addShotef(PEOPLE[0], "f");
    await addShotef(PEOPLE[1], "m");

    const roster = await getShotefRotation();
    expect(roster.map((member) => member.name)).toEqual([
      "נועה ברקת",
      "איתי שרון",
    ]);
    expect(roster[0]).toMatchObject({
      role: "ראשת צוות",
      gender: "f",
      directoryId: "guid-noa",
    });
    expect(roster[1].gender).toBe("m");
  });

  it("is empty on a database that has never been written", async () => {
    await expect(getShotefRotation()).resolves.toEqual([]);
  });
});

describe("mutations are scoped to the key", () => {
  it("removes from one rotation without touching the other", async () => {
    const userId = await upsertRosterUser(PEOPLE[0]);
    const other = await upsertRosterUser(PEOPLE[1]);
    await addMember(userId, "f");
    await addMember(other, "m");
    await addShotefMember(userId, "f");
    await addShotefMember(other, "m");

    expect(await removeShotefMember(userId)).toBe("removed");

    expect((await getShotefRotation()).map((member) => member.id)).toEqual([other]);
    // Still both, on the meetup side.
    expect((await getRotation()).map((member) => member.id)).toEqual([userId, other]);
  });

  it("reports not-found for someone who is only in the other rotation", async () => {
    const userId = await upsertRosterUser(PEOPLE[0]);
    await addMember(userId, "f");
    await seedShotef([PEOPLE[1], PEOPLE[2]]);

    expect(await removeShotefMember(userId)).toBe("not-found");
    expect(await setShotefGender(userId, "m")).toBe(false);
  });

  it("refuses to empty the שוטף rotation — nobody on duty is not a week", async () => {
    const [only] = await seedShotef([PEOPLE[0]]);

    expect(await removeShotefMember(only)).toBe("last");
    expect(await getShotefRotation()).toHaveLength(1);
  });

  it("sets a gender on one row only", async () => {
    const userId = await upsertRosterUser(PEOPLE[0]);
    const other = await upsertRosterUser(PEOPLE[1]);
    await addMember(userId, "f");
    await addMember(other, "f");
    await addShotefMember(userId, "f");
    await addShotefMember(other, "f");

    expect(await setShotefGender(userId, "m")).toBe(true);

    expect((await getShotefRotation())[0].gender).toBe("m");
    expect((await getRotation())[0].gender).toBe("f");
  });

  it("reorders one rotation and leaves the other in its own order", async () => {
    const ids: string[] = [];
    for (const person of PEOPLE) {
      const userId = await upsertRosterUser(person);
      await addMember(userId, "f");
      await addShotefMember(userId, "f");
      ids.push(userId);
    }
    const [a, b, c] = ids;

    expect(await reorderShotefMembers([c, a, b])).toEqual({ ok: true });
    expect((await getShotefRotation()).map((member) => member.id)).toEqual([c, a, b]);
    expect((await getRotation()).map((member) => member.id)).toEqual([a, b, c]);
  });

  it("rejects an order naming someone who is only in the other rotation", async () => {
    const outsider = await upsertRosterUser(PEOPLE[2]);
    await addMember(outsider, "m");
    const [a, b] = await seedShotef([PEOPLE[0], PEOPLE[1]]);

    expect(await reorderShotefMembers([a, outsider])).toEqual({ ok: false });
    expect((await getShotefRotation()).map((member) => member.id)).toEqual([a, b]);
  });

  it("keeps the meetup rotation's own reorder pointed at its own row", async () => {
    const ids: string[] = [];
    for (const person of PEOPLE.slice(0, 2)) {
      const userId = await upsertRosterUser(person);
      await addMember(userId, "f");
      await addShotefMember(userId, "f");
      ids.push(userId);
    }

    expect(await reorderMembers([ids[1], ids[0]])).toEqual({ ok: true });
    expect((await getRotation()).map((member) => member.id)).toEqual([ids[1], ids[0]]);
    expect((await getShotefRotation()).map((member) => member.id)).toEqual(ids);
  });

  it("re-adding a removed member lands on their existing users row", async () => {
    const [firstId] = await seedShotef([PEOPLE[0], PEOPLE[1]]);
    expect(await removeShotefMember(firstId)).toBe("removed");

    const { userId: readded } = await addShotef(PEOPLE[0]);
    expect(readded).toBe(firstId);
  });
});

describe("the anchored shift reads from the stored roster", () => {
  // The same accepted trade-off the ישב״צ rotation documents: the turn is
  // `weeksElapsed % size`, so editing the roster moves everyone's upcoming
  // week. Past weeks are safe — a review records who was actually on duty.
  it("moves whose week it is when the roster changes size", async () => {
    const shift = currentShift(new Date("2026-08-26T09:00:00.000Z"));

    const ids = await seedShotef(PEOPLE); // 3
    const before = await getShotefRotation();
    const upBefore = before[shiftIndex(shift, before.length)];

    const removeId = ids.find((id) => id !== upBefore.id)!;
    expect(await removeShotefMember(removeId)).toBe("removed");

    const after = await getShotefRotation();
    expect(after).toHaveLength(2);
    // Three people and two give a different slot for this particular Sunday,
    // which is the whole point: the schedule is derived, never stored.
    expect(shiftIndex(shift, 3)).not.toBe(shiftIndex(shift, 2));
  });

  it("indexes an empty roster to 0 rather than dividing by nothing", () => {
    expect(shiftIndex(currentShift(new Date("2026-08-26T09:00:00.000Z")), 0)).toBe(0);
  });
});
