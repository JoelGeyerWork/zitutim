import { describe, expect, it } from "vitest";

import {
  HALL_OF_FAME,
  HANDOVER_WEEKDAY,
  SHOTEF_REVIEWS,
  SHOTEF_ROSTER,
  alertingDays,
  averageRating,
  buildShifts,
  byNewest,
  currentShift,
  fastestFix,
  handoverOf,
  memberById,
  shiftIndex,
  solverBoard,
  solversOf,
  type SolvedMonitor,
} from "@/lib/shotef";
import { rotate, type Member } from "@/lib/team";

/**
 * A stand-in roster, like `team.test.ts` keeps: these are tests of the pure
 * shift math, which takes whatever list the caller hands it. The app's own
 * roster is hard-coded for now, and is checked separately below.
 */
const ROSTER: Member[] = [
  { id: "a", name: "אלף", role: "role", gender: "f" },
  { id: "b", name: "בית", role: "role", gender: "m" },
  { id: "c", name: "גימל", role: "role", gender: "f" },
];

describe("currentShift", () => {
  it("lands on the handover weekday at UTC midnight", () => {
    const shift = currentShift(new Date("2026-08-26T09:00:00.000Z"));

    expect(shift.getUTCDay()).toBe(HANDOVER_WEEKDAY);
    expect(shift.toISOString()).toBe("2026-08-23T00:00:00.000Z");
  });

  // The whole point of a shift: it opens on handover day and stays the running
  // one all week, rather than rolling forward to the next Sunday on Monday.
  it("counts handover day itself as the week that just opened", () => {
    expect(currentShift(new Date("2026-08-23T23:00:00.000Z")).toISOString()).toBe(
      "2026-08-23T00:00:00.000Z",
    );
  });

  // A time of day that is the previous date in UTC-5, to catch local-time math.
  it("does the arithmetic in UTC", () => {
    expect(currentShift(new Date("2026-08-23T02:00:00.000Z")).toISOString()).toBe(
      "2026-08-23T00:00:00.000Z",
    );
  });
});

describe("handoverOf", () => {
  it("is a week after the shift opened", () => {
    expect(handoverOf("2026-08-23T00:00:00.000Z")).toBe(
      "2026-08-30T00:00:00.000Z",
    );
  });
});

describe("shiftIndex", () => {
  it("advances by one every week and wraps at the end of the roster", () => {
    const first = new Date("2026-08-23T00:00:00.000Z");
    const weeks = Array.from({ length: 4 }, (_, week) =>
      shiftIndex(
        new Date(first.getTime() + week * 7 * 24 * 60 * 60 * 1000),
        ROSTER.length,
      ),
    );

    expect(weeks).toEqual([weeks[0], (weeks[0] + 1) % 3, (weeks[0] + 2) % 3, weeks[0]]);
  });

  it("stays in range before the anchor", () => {
    expect(shiftIndex(new Date("2025-01-05T00:00:00.000Z"), 3)).toBeGreaterThanOrEqual(0);
    expect(shiftIndex(new Date("2025-01-05T00:00:00.000Z"), 3)).toBeLessThan(3);
  });

  it("is 0 for an empty roster rather than NaN", () => {
    expect(shiftIndex(new Date("2026-08-23T00:00:00.000Z"), 0)).toBe(0);
  });
});

describe("buildShifts", () => {
  const now = new Date("2026-08-25T00:00:00.000Z");
  const queue = rotate(ROSTER, shiftIndex(currentShift(now), ROSTER.length));

  it("opens with the week now running", () => {
    const [first] = buildShifts(now, 3, queue);

    expect(first.date).toBe(currentShift(now).toISOString());
    expect(first.weeksAway).toBe(0);
    expect(first.member).toBe(queue[0]);
  });

  it("hands the following weeks on in order, a week apart", () => {
    const shifts = buildShifts(now, 5, queue);

    expect(shifts.map((shift) => shift.member.id)).toEqual([
      queue[0].id,
      queue[1].id,
      queue[2].id,
      queue[0].id,
      queue[1].id,
    ]);
    expect(shifts[1].date).toBe(handoverOf(shifts[0].date));
  });
});

describe("averageRating", () => {
  it("averages to one decimal", () => {
    expect(
      averageRating([
        { ...SHOTEF_REVIEWS[0], rating: 5 },
        { ...SHOTEF_REVIEWS[0], rating: 4 },
        { ...SHOTEF_REVIEWS[0], rating: 4 },
      ]),
    ).toBe(4.3);
  });

  it("is 0 with nothing to average, rather than NaN", () => {
    expect(averageRating([])).toBe(0);
  });
});

/** A plaque with only the fields a given test cares about spelled out. */
const plaque = (over: Partial<SolvedMonitor>): SolvedMonitor => ({
  ...HALL_OF_FAME[0],
  ...over,
});

describe("byNewest", () => {
  it("orders the wall by when, since nothing there outranks anything else", () => {
    const wall = byNewest([
      plaque({ id: "1", solvedAt: "2026-02-01T00:00:00.000Z" }),
      plaque({ id: "2", solvedAt: "2026-08-01T00:00:00.000Z" }),
      plaque({ id: "3", solvedAt: "2026-05-01T00:00:00.000Z" }),
    ]);

    expect(wall.map((monitor) => monitor.id)).toEqual(["2", "3", "1"]);
  });

  it("leaves the source list alone", () => {
    const wall = [
      plaque({ id: "1", solvedAt: "2026-02-01T00:00:00.000Z" }),
      plaque({ id: "2", solvedAt: "2026-08-01T00:00:00.000Z" }),
    ];
    byNewest(wall);

    expect(wall.map((monitor) => monitor.id)).toEqual(["1", "2"]);
  });
});

describe("solverBoard", () => {
  it("counts plaques per person, most first", () => {
    const board = solverBoard([
      plaque({ id: "1", solvedByIds: ["ori"] }),
      plaque({ id: "2", solvedByIds: ["maya"] }),
      plaque({ id: "3", solvedByIds: ["ori"] }),
    ]);

    expect(board.map((row) => [row.member.id, row.solved])).toEqual([
      ["ori", 2],
      ["maya", 1],
    ]);
  });

  it("breaks a tie on the newest save", () => {
    const board = solverBoard([
      plaque({ id: "1", solvedByIds: ["ori"], solvedAt: "2026-01-01T00:00:00.000Z" }),
      plaque({ id: "2", solvedByIds: ["maya"], solvedAt: "2026-05-01T00:00:00.000Z" }),
    ]);

    expect(board[0].member.id).toBe("maya");
    expect(board[0].lastSolved).toBe("2026-05-01T00:00:00.000Z");
  });

  // A monitor keeps its plaque either way — the board is about people, and
  // someone off the roster has no row to put on it.
  it("drops a solver who is no longer on the roster", () => {
    const board = solverBoard([
      plaque({ id: "1", solvedByIds: ["who"] }),
      plaque({ id: "2", solvedByIds: ["ori", "who"] }),
    ]);

    expect(board.map((row) => [row.member.id, row.solved])).toEqual([
      ["ori", 1],
    ]);
  });

  it("credits every name on a certificate", () => {
    const board = solverBoard([
      plaque({ id: "1", solvedByIds: ["ori", "maya", "tamar"] }),
      plaque({ id: "2", solvedByIds: ["maya"] }),
    ]);

    // maya leads on count; the two on one plaque tie on count *and* on date,
    // and keep the order they are written on the certificate.
    expect(board.map((row) => [row.member.id, row.solved])).toEqual([
      ["maya", 2],
      ["ori", 1],
      ["tamar", 1],
    ]);
  });

  // Counting the names rather than the certificates would let one typo hand
  // somebody two plaques for one save.
  it("counts a certificate once for a name written on it twice", () => {
    const board = solverBoard([plaque({ id: "1", solvedByIds: ["ori", "ori"] })]);

    expect(board).toEqual([
      expect.objectContaining({ solved: 1 }),
    ]);
  });
});

describe("alertingDays", () => {
  it("counts whole days from the first page to the fix", () => {
    expect(
      alertingDays(
        plaque({
          firstFiredAt: "2026-06-09T00:00:00.000Z",
          solvedAt: "2026-08-18T00:00:00.000Z",
        }),
      ),
    ).toBe(70);
  });

  // A monitor caught and fixed the same morning: a real record, and the one
  // that would come out negative if the arithmetic ever ran backwards.
  it("is 0 for a monitor silenced the day it first fired", () => {
    expect(
      alertingDays(
        plaque({
          firstFiredAt: "2026-07-21T00:00:00.000Z",
          solvedAt: "2026-07-21T00:00:00.000Z",
        }),
      ),
    ).toBe(0);
  });
});

describe("fastestFix", () => {
  it("finds the quickest save", () => {
    const fastest = fastestFix([
      plaque({ id: "1", minutesToFix: 300 }),
      plaque({ id: "2", minutesToFix: 11 }),
      plaque({ id: "3", minutesToFix: 90 }),
    ]);

    expect(fastest?.id).toBe("2");
  });

  it("has nothing to name on an empty wall", () => {
    expect(fastestFix([])).toBeUndefined();
  });
});

// The fixtures are what the three screens render today, so a typo in an id
// would show up only as "לא ידוע" on a card.
describe("the hard-coded content", () => {
  it("points every review and monitor at someone on the roster", () => {
    for (const review of SHOTEF_REVIEWS) {
      expect(memberById(review.memberId), review.id).toBeDefined();
    }
    for (const monitor of HALL_OF_FAME) {
      expect(monitor.solvedByIds.length, monitor.id).toBeGreaterThan(0);
      expect(solversOf(monitor), monitor.id).toHaveLength(
        monitor.solvedByIds.length,
      );
    }
  });

  it("keeps every rating inside the 0–5 scale", () => {
    for (const review of SHOTEF_REVIEWS) {
      expect(review.rating).toBeGreaterThanOrEqual(0);
      expect(review.rating).toBeLessThanOrEqual(5);
    }
  });

  it("gives every plaque a monitor to name it and a positive time to fix", () => {
    for (const monitor of HALL_OF_FAME) {
      expect(monitor.monitor, monitor.id).not.toBe("");
      expect(monitor.minutesToFix, monitor.id).toBeGreaterThan(0);
    }
  });

  // A monitor cannot be solved before it first fired, and the certificate
  // renders the span between the two.
  it("fires every monitor before it is silenced", () => {
    for (const monitor of HALL_OF_FAME) {
      expect(
        monitor.firstFiredAt <= monitor.solvedAt,
        monitor.id,
      ).toBe(true);
    }
  });

  it("has no duplicate ids to key a list by", () => {
    const ids = [
      ...SHOTEF_ROSTER.map((member) => member.id),
      ...SHOTEF_REVIEWS.map((review) => review.id),
      ...HALL_OF_FAME.map((monitor) => monitor.id),
    ];

    expect(new Set(ids).size).toBe(ids.length);
  });
});
