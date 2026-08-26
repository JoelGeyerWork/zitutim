import { ObjectId } from "mongodb";
import { beforeEach, describe, expect, it } from "vitest";

import { type DirectoryPerson } from "@/lib/directory-schema";
import { getDb } from "@/lib/mongodb";
import { addShotefMember, getShotefRotation } from "@/lib/shotef";
import {
  createMonitor,
  getFastestFix,
  getSolverBoard,
  listMonitors,
  monitorInputSchema,
  resolveSolvers,
  solverBoard,
  type MonitorActor,
  type MonitorDoc,
  type MonitorInput,
} from "@/lib/shotef-monitors";
import { upsertRosterUser } from "@/lib/users";

const ADDER: MonitorActor = { id: "6b0000000000000000000001", name: "יואל" };

/**
 * Four on the rotation and one off it. The certificate credits `users` rows, so
 * the off-rotation person is a legal solver whose plaque still cannot reach the
 * podium — the case `solverBoard` documents and the aggregation has to match.
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
    const monitor = await createMonitor(input(), ADDER);

    expect(monitor.id).toMatch(/^[a-f0-9]{24}$/);
    expect(monitor.monitor).toBe("db-prod-01: RAM above 95%");
    expect(monitor.solvedByIds).toEqual([userId["אורי בן־חיים"]]);
    expect(monitor.firstFiredAt).toBe("2026-06-09T00:00:00.000Z");
    expect(monitor.solvedAt).toBe("2026-08-18T00:00:00.000Z");
  });

  it("stores the dates at UTC midnight and the solvers as ObjectIds", async () => {
    const monitor = await createMonitor(input(), ADDER);

    const db = await getDb();
    const doc = await db
      .collection<MonitorDoc>("shotef_monitors")
      .findOne({ _id: new ObjectId(monitor.id) });

    expect(doc!.firstFiredAt.toISOString()).toBe("2026-06-09T00:00:00.000Z");
    expect(doc!.solvedByIds[0]).toBeInstanceOf(ObjectId);
    expect(doc!.solvedByIds[0].toHexString()).toBe(userId["אורי בן־חיים"]);
  });

  it("records who typed it in, which the wall itself never shows", async () => {
    const monitor = await createMonitor(input(), ADDER);

    const db = await getDb();
    const doc = await db
      .collection<MonitorDoc>("shotef_monitors")
      .findOne({ _id: new ObjectId(monitor.id) });

    expect(doc!.addedBy).toBe("יואל");
    expect(doc!.addedById!.toHexString()).toBe(ADDER.id);
    // The clerk is not a solver: the credit on the wall is the `solvedByIds`.
    expect(monitor).not.toHaveProperty("addedBy");
  });

  it("keeps every name on a certificate solved by more than one person", async () => {
    const monitor = await createMonitor(
      input({
        solvedByIds: [userId["אורי בן־חיים"], userId["דניאל עמר"]],
      }),
      ADDER,
    );

    expect(monitor.solvedByIds).toEqual([
      userId["אורי בן־חיים"],
      userId["דניאל עמר"],
    ]);
  });
});

describe("listMonitors", () => {
  it("reads newest save first", async () => {
    await createMonitor(input({ monitor: "old", solvedAt: "2026-05-10" }), ADDER);
    await createMonitor(input({ monitor: "new", solvedAt: "2026-08-18" }), ADDER);
    await createMonitor(input({ monitor: "mid", solvedAt: "2026-07-06" }), ADDER);

    const wall = await listMonitors();
    expect(wall.map((m) => m.monitor)).toEqual(["new", "mid", "old"]);
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
    await createMonitor(
      input({ solvedByIds: [userId["אורי בן־חיים"]], solvedAt: "2026-08-18" }),
      ADDER,
    );
    await createMonitor(
      input({
        solvedByIds: [userId["אורי בן־חיים"], userId["דניאל עמר"]],
        solvedAt: "2026-07-06",
      }),
      ADDER,
    );

    const board = await getSolverBoard();
    expect(board.map((row) => [row.member.name, row.solved])).toEqual([
      ["אורי בן־חיים", 2],
      ["דניאל עמר", 1],
    ]);
    expect(board[0].lastSolved).toBe("2026-08-18T00:00:00.000Z");
  });

  it("breaks a tie on the most recent save", async () => {
    await createMonitor(
      input({ solvedByIds: [userId["דניאל עמר"]], solvedAt: "2026-06-11" }),
      ADDER,
    );
    await createMonitor(
      input({ solvedByIds: [userId["נועה ברקת"]], solvedAt: "2026-08-01" }),
      ADDER,
    );

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

  it("drops a solver who is no longer on the rotation", async () => {
    await createMonitor(
      input({
        solvedByIds: [userId["נועה ברקת"], userId["רועי אשכנזי"]],
      }),
      ADDER,
    );

    const board = await getSolverBoard();
    expect(board.map((row) => row.member.name)).toEqual(["נועה ברקת"]);
  });

  it("never leaks a directoryId onto the public board", async () => {
    await createMonitor(input({ solvedByIds: [userId["נועה ברקת"]] }), ADDER);

    const board = await getSolverBoard();
    expect(board[0].member).not.toHaveProperty("directoryId");
  });

  /**
   * The aggregation and the pure `solverBoard` are two spellings of one rule —
   * this is what stops them drifting. The pure one stays because the client
   * folds an optimistic certificate into it; the aggregated one is what the page
   * reads, so a wall that outgrows one screen still ranks all of it.
   */
  it("agrees with the pure solverBoard over the same data", async () => {
    await createMonitor(
      input({
        solvedByIds: [userId["אורי בן־חיים"], userId["דניאל עמר"]],
        solvedAt: "2026-08-18",
      }),
      ADDER,
    );
    await createMonitor(
      input({ solvedByIds: [userId["אורי בן־חיים"]], solvedAt: "2026-07-06" }),
      ADDER,
    );
    await createMonitor(
      input({
        solvedByIds: [userId["נועה ברקת"], userId["רועי אשכנזי"]],
        solvedAt: "2026-08-01",
      }),
      ADDER,
    );

    const [aggregated, wall, roster] = await Promise.all([
      getSolverBoard(),
      listMonitors(),
      getShotefRotation(),
    ]);

    const pure = solverBoard(wall, roster);
    expect(aggregated).toEqual(
      pure.map((row) => ({
        member: {
          id: row.member.id,
          name: row.member.name,
          role: row.member.role,
          gender: row.member.gender,
        },
        solved: row.solved,
        lastSolved: row.lastSolved,
      })),
    );
  });

  it("is empty on an empty wall", async () => {
    expect(await getSolverBoard()).toEqual([]);
  });
});

describe("getFastestFix", () => {
  it("finds the quickest save across the whole wall", async () => {
    await createMonitor(input({ monitor: "slow", minutesToFix: 2160 }), ADDER);
    await createMonitor(input({ monitor: "quick", minutesToFix: 11 }), ADDER);
    await createMonitor(input({ monitor: "middling", minutesToFix: 240 }), ADDER);

    const fastest = await getFastestFix();
    expect(fastest!.monitor).toBe("quick");
  });

  it("gives a tie to the more recent save, like the pure fastestFix does", async () => {
    await createMonitor(
      input({ monitor: "older", minutesToFix: 60, solvedAt: "2026-05-10" }),
      ADDER,
    );
    await createMonitor(
      input({ monitor: "newer", minutesToFix: 60, solvedAt: "2026-08-18" }),
      ADDER,
    );

    expect((await getFastestFix())!.monitor).toBe("newer");
  });

  it("is undefined on an empty wall", async () => {
    expect(await getFastestFix()).toBeUndefined();
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
