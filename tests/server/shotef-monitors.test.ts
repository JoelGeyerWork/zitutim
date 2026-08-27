import { ObjectId } from "mongodb";
import { beforeEach, describe, expect, it } from "vitest";

import { type DirectoryPerson } from "@/lib/directory-schema";
import { getDb } from "@/lib/mongodb";
import { addShotefMember, removeShotefMember } from "@/lib/shotef";
import {
  createMonitor,
  getFastestFix,
  getHallOfFame,
  getSolverBoard,
  listMonitors,
  monitorInputSchema,
  resolveSolvers,
  type MonitorActor,
  type MonitorDoc,
  type MonitorInput,
} from "@/lib/shotef-monitors";
import { upsertRosterUser } from "@/lib/users";

const ADDER: MonitorActor = { id: "6b0000000000000000000001", name: "יואל" };

/**
 * Four on the rotation and one off it. The certificate credits `users` rows, so
 * the off-rotation person is a legal solver whose name still renders on a
 * plaque — §8 — while having no row on the podium, which ranks the current
 * team. Both halves are pinned below.
 */
const PEOPLE: DirectoryPerson[] = [
  { directoryId: "guid-noa", displayName: "נועה ברקת", title: "ראשת צוות", username: "noa.bareket" },
  { directoryId: "guid-itay", displayName: "איתי שרון", title: "שרת", username: "itay.sharon" },
  { directoryId: "guid-daniel", displayName: "דניאל עמר", title: "תשתיות", username: "daniel.amar" },
  { directoryId: "guid-ori", displayName: "אורי בן־חיים", title: "דאטה", username: "ori.benhaim" },
];

const OFF_ROTATION: DirectoryPerson = {
  directoryId: "guid-roi",
  displayName: "רועי אשכנזי",
  title: "אבטחת מידע",
  username: "roi.ashkenazi",
};

/** Display name → `users._id` hex, for everyone including the off-rotation one. */
let userId: Record<string, string>;

function input(overrides: Partial<MonitorInput> = {}): MonitorInput {
  return {
    monitor: "db-prod-01: RAM above 95%",
    icon: "memory",
    solution: "שאילתת דוח בלי אינדקס משכה את כל הטבלה לזיכרון. הוספנו אינדקס מורכב.",
    solvedByIds: [userId["אורי בן־חיים"]],
    firstFiredAt: "2026-06-09",
    solvedAt: "2026-08-18",
    minutesToFix: 180,
    ...overrides,
  };
}

/**
 * The write path as the route drives it: resolve the names, then store. Going
 * through `resolveSolvers` rather than handing `createMonitor` a made-up list
 * is what keeps these tests honest about the one read the route actually does.
 */
async function create(overrides: Partial<MonitorInput> = {}) {
  const parsed = input(overrides);
  const resolved = await resolveSolvers(parsed.solvedByIds);
  if (!resolved.ok) throw new Error("the test named somebody who does not exist");
  return createMonitor(parsed, ADDER, resolved.solvers);
}

beforeEach(async () => {
  const db = await getDb();
  await db.collection("shotef_monitors").deleteMany({});
  await db.collection("rotation").deleteMany({});
  await db.collection("users").deleteMany({});

  userId = {};
  for (const person of PEOPLE) {
    const id = await upsertRosterUser(person);
    userId[person.displayName] = id;
    await addShotefMember(id, "f");
  }
  userId[OFF_ROTATION.displayName] = await upsertRosterUser(OFF_ROTATION);
});

describe("createMonitor", () => {
  it("stores the certificate and hands back the client shape", async () => {
    const monitor = await create();

    expect(monitor.id).toMatch(/^[a-f0-9]{24}$/);
    expect(monitor.monitor).toBe("db-prod-01: RAM above 95%");
    expect(monitor.solvedBy).toEqual([
      { id: userId["אורי בן־חיים"], name: "אורי בן־חיים" },
    ]);
    expect(monitor.firstFiredAt).toBe("2026-06-09T00:00:00.000Z");
    expect(monitor.solvedAt).toBe("2026-08-18T00:00:00.000Z");
  });

  it("stores the dates at UTC midnight and the solvers as ObjectIds", async () => {
    const monitor = await create();

    const db = await getDb();
    const doc = await db
      .collection<MonitorDoc>("shotef_monitors")
      .findOne({ _id: new ObjectId(monitor.id) });

    expect(doc!.firstFiredAt.toISOString()).toBe("2026-06-09T00:00:00.000Z");
    expect(doc!.solvedByIds[0]).toBeInstanceOf(ObjectId);
    expect(doc!.solvedByIds[0].toHexString()).toBe(userId["אורי בן־חיים"]);
  });

  // The document holds ids; the name is joined on read. Storing a snapshot is
  // the thing §8 rejects — it would go stale the day AD renames somebody.
  it("stores no name on the document, only the reference", async () => {
    const monitor = await create();

    const db = await getDb();
    const doc = await db
      .collection<MonitorDoc>("shotef_monitors")
      .findOne({ _id: new ObjectId(monitor.id) });

    expect(doc).not.toHaveProperty("solvedBy");
  });

  it("records who typed it in, which the wall itself never shows", async () => {
    const monitor = await create();

    const db = await getDb();
    const doc = await db
      .collection<MonitorDoc>("shotef_monitors")
      .findOne({ _id: new ObjectId(monitor.id) });

    expect(doc!.addedBy).toBe("יואל");
    expect(doc!.addedById!.toHexString()).toBe(ADDER.id);
    // The clerk is not a solver: the credit on the wall is the `solvedBy`.
    expect(monitor).not.toHaveProperty("addedBy");
  });

  it("keeps every name on a certificate solved by more than one person", async () => {
    const monitor = await create({
      solvedByIds: [userId["אורי בן־חיים"], userId["דניאל עמר"]],
    });

    expect(monitor.solvedBy.map((solver) => solver.name)).toEqual([
      "אורי בן־חיים",
      "דניאל עמר",
    ]);
  });
});

describe("listMonitors", () => {
  it("reads newest save first", async () => {
    await create({ monitor: "old", solvedAt: "2026-05-10" });
    await create({ monitor: "new", solvedAt: "2026-08-18" });
    await create({ monitor: "mid", solvedAt: "2026-07-06" });

    const wall = await listMonitors();
    expect(wall.map((m) => m.monitor)).toEqual(["new", "mid", "old"]);
  });

  it("resolves every name on a plaque out of users", async () => {
    await create({
      solvedByIds: [userId["אורי בן־חיים"], userId["דניאל עמר"]],
    });

    const [plaque] = await listMonitors();
    expect(plaque.solvedBy).toEqual([
      { id: userId["אורי בן־חיים"], name: "אורי בן־חיים" },
      { id: userId["דניאל עמר"], name: "דניאל עמר" },
    ]);
  });

  /**
   * §8, and the whole reason the wall joins to `users` rather than looking a
   * solver up in the on-call rotation: a certificate is a record of something
   * that happened, and it must not lose a recipient the day they leave.
   */
  it("keeps a name on the wall after that person leaves the rotation", async () => {
    await create({ solvedByIds: [userId["נועה ברקת"]] });
    await removeShotefMember(userId["נועה ברקת"]);

    const [plaque] = await listMonitors();
    expect(plaque.solvedBy).toEqual([
      { id: userId["נועה ברקת"], name: "נועה ברקת" },
    ]);
  });

  it("names somebody who was never on the rotation at all", async () => {
    await create({ solvedByIds: [userId["רועי אשכנזי"]] });

    const [plaque] = await listMonitors();
    expect(plaque.solvedBy[0].name).toBe("רועי אשכנזי");
  });

  // Resolved on read, not snapshotted: a rename in the directory reaches every
  // plaque at once, with no stale copy anywhere to go looking for.
  it("follows a rename in the directory onto plaques already hung", async () => {
    await create({ solvedByIds: [userId["נועה ברקת"]] });

    await upsertRosterUser({ ...PEOPLE[0], displayName: "נועה ברקת־שרון" });

    const [plaque] = await listMonitors();
    expect(plaque.solvedBy[0].name).toBe("נועה ברקת־שרון");
    expect(plaque.solvedBy[0].id).toBe(userId["נועה ברקת"]);
  });

  it("is empty on an empty wall", async () => {
    expect(await listMonitors()).toEqual([]);
  });
});

describe("resolveSolvers", () => {
  it("accepts ids that are all real users", async () => {
    const result = await resolveSolvers([
      userId["אורי בן־חיים"],
      userId["דניאל עמר"],
    ]);
    expect(result.ok).toBe(true);
  });

  it("hands back the names in the order they were written", async () => {
    const result = await resolveSolvers([
      userId["דניאל עמר"],
      userId["אורי בן־חיים"],
    ]);

    expect(result.ok && result.solvers.map((solver) => solver.name)).toEqual([
      "דניאל עמר",
      "אורי בן־חיים",
    ]);
  });

  it("accepts someone off the on-call rotation — the wall is not the roster", async () => {
    const result = await resolveSolvers([userId["רועי אשכנזי"]]);
    expect(result.ok).toBe(true);
  });

  it("reports an id that resolves to no user, rather than writing it", async () => {
    const result = await resolveSolvers([
      userId["אורי בן־חיים"],
      "6b00000000000000000000ff",
    ]);

    expect(result.ok).toBe(false);
    expect(result.ok === false && result.issues.solvedByIds).toBeTruthy();
  });

  it("reports a malformed id instead of throwing on the ObjectId", async () => {
    const result = await resolveSolvers(["not-an-object-id"]);
    expect(result.ok).toBe(false);
  });
});

describe("getSolverBoard", () => {
  it("counts certificates per person, most first", async () => {
    await create({
      solvedByIds: [userId["אורי בן־חיים"]],
      solvedAt: "2026-08-18",
    });
    await create({
      solvedByIds: [userId["אורי בן־חיים"], userId["דניאל עמר"]],
      solvedAt: "2026-07-06",
    });

    const board = await getSolverBoard();
    expect(board.map((row) => [row.member.name, row.solved])).toEqual([
      ["אורי בן־חיים", 2],
      ["דניאל עמר", 1],
    ]);
    expect(board[0].lastSolved).toBe("2026-08-18T00:00:00.000Z");
  });

  it("breaks a tie on the most recent save", async () => {
    await create({ solvedByIds: [userId["דניאל עמר"]], solvedAt: "2026-06-11" });
    await create({ solvedByIds: [userId["נועה ברקת"]], solvedAt: "2026-08-01" });

    const board = await getSolverBoard();
    expect(board.map((row) => row.member.name)).toEqual([
      "נועה ברקת",
      "דניאל עמר",
    ]);
  });

  it("counts a name written twice on one certificate once", async () => {
    // Inserted straight into the collection: `monitorInputSchema` folds the
    // array through a `Set`, so the only way a duplicate reaches the database is
    // a document that predates the schema — and the aggregation is what has to
    // survive it, exactly as `solversOf` does on the client.
    const db = await getDb();
    const twice = new ObjectId(userId["אורי בן־חיים"]);
    await db.collection<MonitorDoc>("shotef_monitors").insertOne({
      _id: new ObjectId(),
      icon: "memory",
      monitor: "duplicated: same name twice",
      solution: "שם שנכתב פעמיים על אותה תעודה",
      solvedByIds: [twice, twice],
      firstFiredAt: new Date("2026-06-09"),
      solvedAt: new Date("2026-06-10"),
      minutesToFix: 30,
      addedBy: null,
      addedById: null,
      createdAt: new Date(),
    });

    const board = await getSolverBoard();
    expect(board).toHaveLength(1);
    expect(board[0].solved).toBe(1);
  });

  /**
   * The other half of §8, and the deliberate asymmetry: the podium ranks the
   * *current* team, so someone off the rotation has no row on it — while the
   * plaque they earned keeps their name, which the `listMonitors` tests pin.
   */
  it("drops a solver who is not on the rotation, though their plaque keeps them", async () => {
    await create({
      solvedByIds: [userId["נועה ברקת"], userId["רועי אשכנזי"]],
    });

    const board = await getSolverBoard();
    expect(board.map((row) => row.member.name)).toEqual(["נועה ברקת"]);

    const [plaque] = await listMonitors();
    expect(plaque.solvedBy.map((solver) => solver.name)).toEqual([
      "נועה ברקת",
      "רועי אשכנזי",
    ]);
  });

  it("never leaks a directoryId onto the public board", async () => {
    await create({ solvedByIds: [userId["נועה ברקת"]] });

    const board = await getSolverBoard();
    expect(board[0].member).not.toHaveProperty("directoryId");
  });

  it("carries the gender the podium needs, which only the rotation has", async () => {
    await create({ solvedByIds: [userId["נועה ברקת"]] });

    const board = await getSolverBoard();
    expect(board[0].member.gender).toBe("f");
  });

  it("is empty on an empty wall", async () => {
    expect(await getSolverBoard()).toEqual([]);
  });
});

describe("getFastestFix", () => {
  it("finds the quickest save across the whole wall", async () => {
    await create({ monitor: "slow", minutesToFix: 2160 });
    await create({ monitor: "quick", minutesToFix: 11 });
    await create({ monitor: "middling", minutesToFix: 240 });

    const fastest = await getFastestFix();
    expect(fastest!.monitor).toBe("quick");
  });

  it("gives a tie to the more recent save", async () => {
    await create({ monitor: "older", minutesToFix: 60, solvedAt: "2026-05-10" });
    await create({ monitor: "newer", minutesToFix: 60, solvedAt: "2026-08-18" });

    expect((await getFastestFix())!.monitor).toBe("newer");
  });

  it("resolves its solvers too, since the wall may render it", async () => {
    await create({ solvedByIds: [userId["דניאל עמר"]], minutesToFix: 11 });

    expect((await getFastestFix())!.solvedBy[0].name).toBe("דניאל עמר");
  });

  it("is undefined on an empty wall", async () => {
    expect(await getFastestFix()).toBeUndefined();
  });
});

describe("getHallOfFame", () => {
  it("answers the wall and both aggregates in one shape", async () => {
    await create({ monitor: "slow one", minutesToFix: 2160 });
    await create({
      monitor: "quick one",
      minutesToFix: 11,
      solvedAt: "2026-07-21",
    });

    const { monitors, board, fastest } = await getHallOfFame();
    expect(monitors.map((m) => m.monitor)).toEqual(["slow one", "quick one"]);
    expect(board[0].solved).toBe(2);
    expect(fastest!.monitor).toBe("quick one");
  });

  // An unseeded database is a real state, and the page has to render it rather
  // than being handed a `fastest` that does not exist.
  it("names no fastest fix on an empty wall", async () => {
    expect(await getHallOfFame()).toEqual({
      monitors: [],
      board: [],
      fastest: null,
    });
  });
});

describe("monitorInputSchema stays authoritative", () => {
  it("refuses a monitor solved before it first fired", () => {
    const parsed = monitorInputSchema.safeParse(
      input({ firstFiredAt: "2026-08-18", solvedAt: "2026-06-09" }),
    );

    expect(parsed.success).toBe(false);
    expect(parsed.error!.issues[0].path).toEqual(["firstFiredAt"]);
  });

  it("dedupes solvedByIds before anything stores them", () => {
    const id = userId["אורי בן־חיים"];
    const parsed = monitorInputSchema.parse(input({ solvedByIds: [id, id] }));
    expect(parsed.solvedByIds).toEqual([id]);
  });
});
