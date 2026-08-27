import { beforeEach, describe, expect, it } from "vitest";

import { GET, POST } from "@/app/api/shotef/monitors/route";
import { type DirectoryPerson } from "@/lib/directory-schema";
import { getDb } from "@/lib/mongodb";
import { addShotefMember, removeShotefMember } from "@/lib/shotef";
import { upsertRosterUser } from "@/lib/users";
import { sessionCookie } from "./factories";

const BASE = "http://localhost:3000/api/shotef/monitors";

const PEOPLE: DirectoryPerson[] = [
  { directoryId: "guid-ori", displayName: "אורי בן־חיים", title: "דאטה", username: "ori.benhaim" },
  { directoryId: "guid-daniel", displayName: "דניאל עמר", title: "תשתיות", username: "daniel.amar" },
];

let userId: Record<string, string>;

async function mutate(
  url: string,
  method: string,
  payload?: unknown,
  cookie: string | null | undefined = undefined,
) {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  const value = cookie === undefined ? await sessionCookie() : cookie;
  if (value) headers.cookie = value;

  return new Request(url, {
    method,
    headers,
    body:
      payload === undefined
        ? undefined
        : typeof payload === "string"
          ? payload
          : JSON.stringify(payload),
  });
}

async function post(payload: unknown, cookie?: string | null) {
  return POST(await mutate(BASE, "POST", payload, cookie));
}

function body(overrides: Record<string, unknown> = {}) {
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
    await addShotefMember(id, "m");
  }
});

describe("GET /api/shotef/monitors", () => {
  it("is public and answers with the wall, the board and the fastest fix", async () => {
    await post(body({ monitor: "slow one", minutesToFix: 2160 }));
    await post(
      body({
        monitor: "quick one",
        minutesToFix: 11,
        solvedAt: "2026-07-21",
        solvedByIds: [userId["אורי בן־חיים"], userId["דניאל עמר"]],
      }),
    );

    // No cookie: the read is public, like every other GET here.
    const response = await GET();
    expect(response.status).toBe(200);

    const { monitors, board, fastest } = await response.json();
    expect(monitors.map((m: { monitor: string }) => m.monitor)).toEqual([
      "slow one",
      "quick one",
    ]);
    expect(board.map((row: { member: { name: string }; solved: number }) => [
      row.member.name,
      row.solved,
    ])).toEqual([
      ["אורי בן־חיים", 2],
      ["דניאל עמר", 1],
    ]);
    expect(fastest.monitor).toBe("quick one");
  });

  /**
   * §8 end to end: the plaque keeps the name, the podium loses the row. The
   * rotation gates the leaderboard, which is a ranking of the current team; a
   * certificate is a record of something that happened.
   */
  it("keeps a departed solver on their plaque but off the podium", async () => {
    await post(body({ solvedByIds: [userId["אורי בן־חיים"]] }));
    await removeShotefMember(userId["אורי בן־חיים"]);

    const { monitors, board } = await (await GET()).json();
    expect(monitors[0].solvedBy).toEqual([
      { id: userId["אורי בן־חיים"], name: "אורי בן־חיים" },
    ]);
    expect(board).toEqual([]);
  });

  it("answers an empty wall without inventing a fastest fix", async () => {
    const { monitors, board, fastest } = await (await GET()).json();
    expect(monitors).toEqual([]);
    expect(board).toEqual([]);
    expect(fastest).toBeNull();
  });
});

describe("POST /api/shotef/monitors", () => {
  it("creates a certificate and returns 201 with the saved record", async () => {
    const response = await post(body());
    expect(response.status).toBe(201);

    const monitor = await response.json();
    expect(monitor.id).toMatch(/^[a-f0-9]{24}$/);
    expect(monitor.monitor).toBe("db-prod-01: RAM above 95%");
    expect(monitor.firstFiredAt).toBe("2026-06-09T00:00:00.000Z");
    expect(monitor.solvedAt).toBe("2026-08-18T00:00:00.000Z");
    // The record comes back with the names already resolved, so the wall can
    // hang the plaque without a second read.
    expect(monitor.solvedBy).toEqual([
      { id: userId["אורי בן־חיים"], name: "אורי בן־חיים" },
    ]);
  });

  it("keeps every name on a certificate more than one person earned", async () => {
    const response = await post(
      body({ solvedByIds: [userId["אורי בן־חיים"], userId["דניאל עמר"]] }),
    );

    const monitor = await response.json();
    expect(monitor.solvedBy.map((s: { name: string }) => s.name)).toEqual([
      "אורי בן־חיים",
      "דניאל עמר",
    ]);
  });

  it("dedupes a name sent twice rather than counting it twice", async () => {
    const id = userId["אורי בן־חיים"];
    const monitor = await (await post(body({ solvedByIds: [id, id] }))).json();
    expect(monitor.solvedBy).toEqual([{ id, name: "אורי בן־חיים" }]);

    const { board } = await (await GET()).json();
    expect(board[0].solved).toBe(1);
  });

  it("422s a monitor solved before it first fired", async () => {
    const response = await post(
      body({ firstFiredAt: "2026-08-18", solvedAt: "2026-06-09" }),
    );

    expect(response.status).toBe(422);
    const { issues } = await response.json();
    expect(issues.firstFiredAt).toBeTruthy();
  });

  it("422s an empty solver list", async () => {
    const response = await post(body({ solvedByIds: [] }));
    expect(response.status).toBe(422);
    const { issues } = await response.json();
    expect(issues.solvedByIds).toBeTruthy();
  });

  // An id nobody in `users` answers to is bad input, not a server fault: the
  // route must not take the client's word for who exists and write a plaque
  // with a dangling reference on it.
  it("422s a solver id that resolves to no user", async () => {
    const response = await post(
      body({ solvedByIds: [userId["אורי בן־חיים"], "6b00000000000000000000ff"] }),
    );

    expect(response.status).toBe(422);
    const { issues } = await response.json();
    expect(issues.solvedByIds).toBeTruthy();

    const db = await getDb();
    expect(await db.collection("shotef_monitors").countDocuments()).toBe(0);
  });

  it("422s a malformed solver id instead of 500ing on the ObjectId", async () => {
    const response = await post(body({ solvedByIds: ["noa"] }));
    expect(response.status).toBe(422);
  });

  it("401s an anonymous POST", async () => {
    const response = await post(body(), null);
    expect(response.status).toBe(401);
  });

  // The ordering is the point: an anonymous caller must not be able to tell a
  // valid body from an invalid one, or the 422 becomes a probing oracle.
  it("401s an anonymous POST with an invalid body, before parsing it", async () => {
    const response = await post({ monitor: "" }, null);
    expect(response.status).toBe(401);

    const db = await getDb();
    expect(await db.collection("shotef_monitors").countDocuments()).toBe(0);
  });

  it("401s an anonymous POST whose body is not even JSON", async () => {
    const response = await post("{{{", null);
    expect(response.status).toBe(401);
  });

  it("400s a signed-in POST whose body is not JSON", async () => {
    const response = await post("{{{");
    expect(response.status).toBe(400);
  });

  it("rejects a cross-origin POST even with a valid session", async () => {
    const response = await POST(
      new Request(BASE, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          origin: "https://evil.example",
          cookie: await sessionCookie(),
        },
        body: JSON.stringify(body()),
      }),
    );

    expect(response.status).toBe(403);
  });
});
