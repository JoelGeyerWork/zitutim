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
  byWeek,
  closedWeeks,
  monitorInputSchema,
  newMonitor,
  newReview,
  reviewInputSchema,
  shiftIndex,
  shotefOn,
  solverBoard,
  solversOf,
  type SolvedMonitor,
} from "@/lib/shotef-schema";
import { rotate, type Member } from "@/lib/team";

/**
 * A stand-in roster, like `team.test.ts` keeps: these are tests of the pure
 * shift math, which takes whatever list the caller hands it. The real on-call
 * roster is the `_id: "shotef"` rotation document — see `shotef-rotation.test.ts`
 * — while `SHOTEF_ROSTER` is only what the two fixture lists still point at, and
 * is checked as such at the bottom of this file.
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

  // The roster is a database document now, and an unseeded one has never had a
  // member. `week % 0` is NaN, so the old version handed back the requested
  // number of shifts with no member on any of them.
  it("hands back nothing at all when nobody is on the rotation", () => {
    expect(buildShifts(now, 5, [])).toEqual([]);
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
    const board = solverBoard(
      [
        plaque({ id: "1", solvedByIds: ["ori"] }),
        plaque({ id: "2", solvedByIds: ["maya"] }),
        plaque({ id: "3", solvedByIds: ["ori"] }),
      ],
      SHOTEF_ROSTER,
    );

    expect(board.map((row) => [row.member.id, row.solved])).toEqual([
      ["ori", 2],
      ["maya", 1],
    ]);
  });

  it("breaks a tie on the newest save", () => {
    const board = solverBoard(
      [
        plaque({ id: "1", solvedByIds: ["ori"], solvedAt: "2026-01-01T00:00:00.000Z" }),
        plaque({ id: "2", solvedByIds: ["maya"], solvedAt: "2026-05-01T00:00:00.000Z" }),
      ],
      SHOTEF_ROSTER,
    );

    expect(board[0].member.id).toBe("maya");
    expect(board[0].lastSolved).toBe("2026-05-01T00:00:00.000Z");
  });

  // A monitor keeps its plaque either way — the board is about people, and
  // someone off the roster has no row to put on it.
  it("drops a solver who is no longer on the roster", () => {
    const board = solverBoard(
      [
        plaque({ id: "1", solvedByIds: ["who"] }),
        plaque({ id: "2", solvedByIds: ["ori", "who"] }),
      ],
      SHOTEF_ROSTER,
    );

    expect(board.map((row) => [row.member.id, row.solved])).toEqual([
      ["ori", 1],
    ]);
  });

  it("credits every name on a certificate", () => {
    const board = solverBoard(
      [
        plaque({ id: "1", solvedByIds: ["ori", "maya", "tamar"] }),
        plaque({ id: "2", solvedByIds: ["maya"] }),
      ],
      SHOTEF_ROSTER,
    );

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
    const board = solverBoard(
      [plaque({ id: "1", solvedByIds: ["ori", "ori"] })],
      SHOTEF_ROSTER,
    );

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

describe("monitorInputSchema", () => {
  const input = {
    monitor: "redis-02: evicted keys above 1k/min",
    icon: "cache" as const,
    solution: "הכפלנו את מגבלת הזיכרון והוצאנו את המפתחות הגדולים.",
    solvedByIds: ["maya"],
    firstFiredAt: "2026-07-01",
    solvedAt: "2026-08-20",
    minutesToFix: 240,
  };

  const issueOn = (over: Record<string, unknown>) => {
    const result = monitorInputSchema.safeParse({ ...input, ...over });
    return result.success ? undefined : result.error.issues[0];
  };

  it("accepts a filled-in form", () => {
    expect(monitorInputSchema.safeParse(input).success).toBe(true);
  });

  it("refuses a certificate with nobody on it", () => {
    expect(issueOn({ solvedByIds: [] })?.message).toBe(
      "צריך לבחור לפחות אדם אחד",
    );
  });

  // The form cannot send a name twice, but a route handler would trust this
  // schema, and that one can be sent anything.
  it("keeps one of a name sent twice", () => {
    const parsed = monitorInputSchema.parse({
      ...input,
      solvedByIds: ["maya", "maya", "ori"],
    });

    expect(parsed.solvedByIds).toEqual(["maya", "ori"]);
  });

  it("refuses a monitor solved before it fired, on the date it blames", () => {
    const issue = issueOn({
      firstFiredAt: "2026-08-21",
      solvedAt: "2026-08-20",
    });

    expect(issue?.path).toEqual(["firstFiredAt"]);
  });

  it("refuses a fix that took no time at all", () => {
    expect(issueOn({ minutesToFix: 0 })).toBeDefined();
    expect(issueOn({ minutesToFix: Number.NaN })).toBeDefined();
  });
});

describe("newMonitor", () => {
  const input = monitorInputSchema.parse({
    monitor: "redis-02: evicted keys above 1k/min",
    icon: "cache",
    solution: "הכפלנו את מגבלת הזיכרון והוצאנו את המפתחות הגדולים.",
    solvedByIds: ["maya"],
    firstFiredAt: "2026-07-01",
    solvedAt: "2026-08-20",
    minutesToFix: 240,
  });

  // The wall's date maths and formatters all read UTC midnight, like `saidAt`.
  it("stores both dates at UTC midnight", () => {
    const monitor = newMonitor(input);

    expect(monitor.firstFiredAt).toBe("2026-07-01T00:00:00.000Z");
    expect(monitor.solvedAt).toBe("2026-08-20T00:00:00.000Z");
    expect(alertingDays(monitor)).toBe(50);
  });

  it("gives every plaque an id of its own, so a list can key by it", () => {
    expect(newMonitor(input).id).not.toBe(newMonitor(input).id);
  });
});

describe("byWeek", () => {
  it("puts the newest week first, whatever order they arrived in", () => {
    const weeks = ["2026-07-05", "2026-08-16", "2026-07-26"].map((week) => ({
      ...SHOTEF_REVIEWS[0],
      id: week,
      weekStart: `${week}T00:00:00.000Z`,
    }));

    expect(byWeek(weeks).map((review) => review.id)).toEqual([
      "2026-08-16",
      "2026-07-26",
      "2026-07-05",
    ]);
  });
});

describe("closedWeeks", () => {
  // Thursday, mid-shift: the week that opened on the 23rd is still running.
  const now = new Date("2026-08-27T09:00:00.000Z");

  it("starts at the last week that ended, not the one still running", () => {
    expect(closedWeeks(now, 3)).toEqual([
      "2026-08-16T00:00:00.000Z",
      "2026-08-09T00:00:00.000Z",
      "2026-08-02T00:00:00.000Z",
    ]);
  });

  // The handover is the earliest moment a week can be scored, so it has to be
  // offered from that morning rather than a day later.
  it("offers the week that just ended on handover morning", () => {
    expect(closedWeeks(new Date("2026-08-23T06:00:00.000Z"), 1)).toEqual([
      "2026-08-16T00:00:00.000Z",
    ]);
  });

  it("only ever names Sundays", () => {
    for (const week of closedWeeks(now, 20)) {
      expect(new Date(week).getUTCDay(), week).toBe(HANDOVER_WEEKDAY);
    }
  });
});

describe("shotefOn", () => {
  it("names whoever the anchored rotation had on duty that week", () => {
    const week = new Date("2026-08-16T00:00:00.000Z");
    const expected = ROSTER[shiftIndex(week, ROSTER.length)];

    expect(shotefOn(week.toISOString(), ROSTER)).toBe(expected);
  });

  it("has nobody to name on an empty roster", () => {
    expect(shotefOn("2026-08-16T00:00:00.000Z", [])).toBeUndefined();
  });
});

describe("reviewInputSchema", () => {
  const input = {
    weekStart: "2026-08-16",
    memberId: "daniel",
    rating: 4,
    headline: "שבוע של תור ריק",
    body: "שתי פניות בלבד, ושתיהן נסגרו לפני הצהריים.",
  };

  const issueOn = (over: Record<string, unknown>) => {
    const result = reviewInputSchema.safeParse({ ...input, ...over });
    return result.success ? undefined : result.error.issues[0];
  };

  it("accepts a filled-in form", () => {
    expect(reviewInputSchema.safeParse(input).success).toBe(true);
  });

  // A shift is a whole Sunday-to-Saturday week, so a week that starts on any
  // other day is not a week anyone was on duty for.
  it("refuses a week that doesn't start on a Sunday", () => {
    expect(issueOn({ weekStart: "2026-08-18" })?.message).toBe(
      "שבוע תורנות מתחיל ביום ראשון",
    );
  });

  // Zero is a real score: a week that went badly is the one worth writing down.
  it("takes zero stars but not a negative or a sixth one", () => {
    expect(reviewInputSchema.safeParse({ ...input, rating: 0 }).success).toBe(
      true,
    );
    expect(issueOn({ rating: -1 })).toBeDefined();
    expect(issueOn({ rating: 6 })).toBeDefined();
  });

  it("refuses a summary with no words in it", () => {
    expect(issueOn({ headline: "  " })).toBeDefined();
    expect(issueOn({ body: "קצר" })).toBeDefined();
  });

  it("refuses a week with nobody on duty", () => {
    expect(issueOn({ memberId: "" })?.message).toBe("צריך לבחור מי היה השוטף");
  });
});

describe("newReview", () => {
  const input = reviewInputSchema.parse({
    weekStart: "2026-08-16",
    memberId: "daniel",
    rating: 4,
    headline: "שבוע של תור ריק",
    body: "שתי פניות בלבד, ושתיהן נסגרו לפני הצהריים.",
  });

  // Same rule as every other date here: stored at UTC midnight, because the
  // formatters read UTC.
  it("stores the week at UTC midnight", () => {
    expect(newReview(input).weekStart).toBe("2026-08-16T00:00:00.000Z");
  });

  it("gives every summary an id of its own, so a list can key by it", () => {
    expect(newReview(input).id).not.toBe(newReview(input).id);
  });
});

// The fixtures are what the three screens render today, so a typo in an id
// would show up only as "לא ידוע" on a card.
describe("the hard-coded content", () => {
  it("points every review and monitor at someone on the roster", () => {
    for (const review of SHOTEF_REVIEWS) {
      expect(memberById(review.memberId, SHOTEF_ROSTER), review.id).toBeDefined();
    }
    for (const monitor of HALL_OF_FAME) {
      expect(monitor.solvedByIds.length, monitor.id).toBeGreaterThan(0);
      expect(solversOf(monitor, SHOTEF_ROSTER), monitor.id).toHaveLength(
        monitor.solvedByIds.length,
      );
    }
  });

  it("opens every reviewed week on a Sunday", () => {
    for (const review of SHOTEF_REVIEWS) {
      expect(new Date(review.weekStart).getUTCDay(), review.id).toBe(
        HANDOVER_WEEKDAY,
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
