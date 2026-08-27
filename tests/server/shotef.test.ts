import { describe, expect, it } from "vitest";

import {
  HANDOVER_WEEKDAY,
  alertingDays,
  averageRating,
  buildShifts,
  byNewest,
  currentShift,
  handoverOf,
  byWeek,
  closedWeeks,
  monitorInputSchema,
  reviewInputSchema,
  shiftIndex,
  shotefOn,
  solversOf,
  type ShotefReview,
  type SolvedMonitor,
} from "@/lib/shotef-schema";
import { directoryRef, userRef } from "@/lib/person-ref";
import { rotate, type Member } from "@/lib/team";

/**
 * A stand-in roster, like `team.test.ts` keeps: these are tests of the pure
 * shift math, which takes whatever list the caller hands it. The real on-call
 * roster is the `_id: "shotef"` rotation document — see `shotef-rotation.test.ts`.
 *
 * Everything in this file is a *pure* helper, and nothing here reaches a
 * database any more. The two fixture lists these tests used to be built on are
 * gone with the collections that replaced them: the wall, the podium, the
 * fastest fix and both create paths are covered against real documents in
 * `shotef-monitors.test.ts` and `shotef-reviews.test.ts`.
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
  // Absolute, not relative to `weeks[0]`: the anchor is what decides *whose*
  // week it is, so a test written against its own first answer proves the step
  // and the wrap while passing for any anchor at all. 2026-01-04 is the Sunday
  // index 0 opened, and 2026-08-23 is 33 weeks after it — 33 % 3 === 0.
  it("counts whole weeks from the anchor, and wraps at the roster's end", () => {
    const first = new Date("2026-08-23T00:00:00.000Z");
    const weeks = Array.from({ length: 4 }, (_, week) =>
      shiftIndex(
        new Date(first.getTime() + week * 7 * 24 * 60 * 60 * 1000),
        ROSTER.length,
      ),
    );

    expect(weeks).toEqual([0, 1, 2, 0]);
  });

  it("puts index 0 on the anchor Sunday itself", () => {
    expect(shiftIndex(new Date("2026-01-04T00:00:00.000Z"), 8)).toBe(0);
    expect(shiftIndex(new Date("2026-01-11T00:00:00.000Z"), 8)).toBe(1);
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

/** A summary with only the fields a given test cares about spelled out. */
const review = (over: Partial<ShotefReview> = {}): ShotefReview => ({
  id: "w-1",
  weekStart: "2026-08-16T00:00:00.000Z",
  memberId: "6b0000000000000000000001",
  memberName: "\u05de\u05d0\u05d9\u05d4 \u05d2\u05dc\u05e2\u05d3",
  rating: 4,
  headline: "\u05e9\u05d1\u05d5\u05e2 \u05e9\u05dc \u05ea\u05d5\u05e8 \u05e8\u05d9\u05e7",
  body: "\u05e9\u05ea\u05d9 \u05e4\u05e0\u05d9\u05d5\u05ea \u05d1\u05dc\u05d1\u05d3, \u05d5\u05e9\u05ea\u05d9\u05d4\u05df \u05e0\u05e1\u05d2\u05e8\u05d5 \u05dc\u05e4\u05e0\u05d9 \u05d4\u05e6\u05d4\u05e8\u05d9\u05d9\u05dd.",
  ...over,
});

describe("averageRating", () => {
  it("averages to one decimal", () => {
    expect(
      averageRating([
        review({ rating: 5 }),
        review({ rating: 4 }),
        review({ rating: 4 }),
      ]),
    ).toBe(4.3);
  });

  it("is 0 with nothing to average, rather than NaN", () => {
    expect(averageRating([])).toBe(0);
  });
});

/**
 * A plaque with only the fields a given test cares about spelled out.
 *
 * Its solvers are `{ id, name }` pairs the way the server hands them down,
 * already resolved out of `users` — a certificate carries every name on it
 * whether or not that person is still on the on-call rotation.
 */
const plaque = (over: Partial<SolvedMonitor> = {}): SolvedMonitor => ({
  id: "m-1",
  icon: "memory",
  monitor: "db-prod-01: RAM above 95%",
  solution: "\u05e9\u05d0\u05d9\u05dc\u05ea\u05ea \u05d3\u05d5\u05d7 \u05d1\u05dc\u05d9 \u05d0\u05d9\u05e0\u05d3\u05e7\u05e1 \u05de\u05e9\u05db\u05d4 \u05d0\u05ea \u05db\u05dc \u05d4\u05d8\u05d1\u05dc\u05d4 \u05dc\u05d6\u05d9\u05db\u05e8\u05d5\u05df.",
  solvedBy: [{ id: "6b0000000000000000000001", name: "\u05d0\u05d5\u05e8\u05d9 \u05d1\u05df\u05be\u05d7\u05d9\u05d9\u05dd" }],
  firstFiredAt: "2026-06-09T00:00:00.000Z",
  solvedAt: "2026-08-18T00:00:00.000Z",
  minutesToFix: 180,
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

describe("solversOf", () => {
  it("keeps every name on the certificate, in the order it is written", () => {
    const solvers = solversOf(
      plaque({
        solvedBy: [
          { id: "u1", name: "\u05d0\u05d5\u05e8\u05d9" },
          { id: "u2", name: "\u05de\u05d0\u05d9\u05d4" },
        ],
      }),
    );

    expect(solvers.map((solver) => solver.name)).toEqual(["\u05d0\u05d5\u05e8\u05d9", "\u05de\u05d0\u05d9\u05d4"]);
  });

  /**
   * Nothing consults a roster here any more — §8. A plaque is a record of
   * something that happened, so it renders every recipient whether or not they
   * are still on the on-call rotation; the podium is the part the rotation
   * still gates, and that is `getSolverBoard`.
   */
  it("names somebody the on-call rotation has never heard of", () => {
    const solvers = solversOf(
      plaque({ solvedBy: [{ id: "gone", name: "\u05e8\u05d5\u05e2\u05d9 \u05d0\u05e9\u05db\u05e0\u05d6\u05d9" }] }),
    );

    expect(solvers).toEqual([{ id: "gone", name: "\u05e8\u05d5\u05e2\u05d9 \u05d0\u05e9\u05db\u05e0\u05d6\u05d9" }]);
  });

  // Only a document written before the schema deduped can arrive doubled, and
  // the view keys its list on the id — so folding it out is not optional.
  it("folds out a name written twice on one certificate", () => {
    const twice = { id: "u1", name: "\u05d0\u05d5\u05e8\u05d9" };

    expect(solversOf(plaque({ solvedBy: [twice, twice] }))).toEqual([twice]);
  });

  it("has nobody to name on a certificate with an empty list", () => {
    expect(solversOf(plaque({ solvedBy: [] }))).toEqual([]);
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

describe("monitorInputSchema", () => {
  const input = {
    monitor: "redis-02: evicted keys above 1k/min",
    icon: "cache" as const,
    solution: "הכפלנו את מגבלת הזיכרון והוצאנו את המפתחות הגדולים.",
    solvedBy: [userRef("6b0000000000000000000011")],
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
    expect(issueOn({ solvedBy: [] })?.message).toBe(
      "צריך לבחור לפחות אדם אחד",
    );
  });

  // The form cannot send a name twice, but a route handler would trust this
  // schema, and that one can be sent anything.
  it("keeps one of a reference sent twice", () => {
    const maya = userRef("6b0000000000000000000011");
    const ori = userRef("6b0000000000000000000012");
    const parsed = monitorInputSchema.parse({
      ...input,
      solvedBy: [maya, maya, ori],
    });

    expect(parsed.solvedBy).toEqual([maya, ori]);
  });

  // Two sources, one field — so a colleague found in the directory rides along
  // in the same ordered list as the rotation picks. Only the server can tell
  // that a `directory` reference and a `user` one are the same person, so the
  // schema leaves both standing.
  it("takes a directory reference beside a user one, in order", () => {
    const parsed = monitorInputSchema.parse({
      ...input,
      solvedBy: [userRef("6b0000000000000000000011"), directoryRef("guid-roi")],
    });

    expect(parsed.solvedBy).toEqual([
      { source: "user", id: "6b0000000000000000000011" },
      { source: "directory", id: "guid-roi" },
    ]);
  });

  it("refuses a name that is neither source", () => {
    expect(issueOn({ solvedBy: [{ source: "guess", id: "maya" }] })).toBeDefined();
    expect(issueOn({ solvedBy: ["maya"] })).toBeDefined();
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

describe("byWeek", () => {
  it("puts the newest week first, whatever order they arrived in", () => {
    const weeks = ["2026-07-05", "2026-08-16", "2026-07-26"].map((week) =>
      review({ id: week, weekStart: `${week}T00:00:00.000Z` }),
    );

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
    member: userRef("6b0000000000000000000011"),
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
    expect(issueOn({ member: undefined })?.message).toBe("צריך לבחור אדם");
    expect(issueOn({ member: { source: "user", id: "" } })).toBeDefined();
  });

  // The rotation's own default sends a `user` reference, which is the whole
  // reason summarising a week needs no directory. A week worked by somebody
  // this app has never seen names them the other way.
  it("takes either source for whose week it was", () => {
    expect(
      reviewInputSchema.safeParse({ ...input, member: directoryRef("guid-roi") })
        .success,
    ).toBe(true);
  });
});
