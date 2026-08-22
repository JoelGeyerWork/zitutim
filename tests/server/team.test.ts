import { describe, expect, it } from "vitest";

import {
  buildRotation,
  currentMeetup,
  daysUntil,
  lastMeetup,
  type Member,
  MEETUP,
  rotate,
  rotationIndex,
} from "@/lib/team";

/**
 * A small stand-in roster, defined here rather than pulled from the app: the
 * real one lives in the `rotation` collection now, and these are tests of the
 * pure date/rotation math, which takes whatever roster the caller hands it.
 */
const ROSTER: Member[] = [
  { id: "a", name: "אלף", role: "role", gender: "f" },
  { id: "b", name: "בית", role: "role", gender: "m" },
  { id: "c", name: "גימל", role: "role", gender: "f" },
  { id: "d", name: "דלת", role: "role", gender: "m" },
];

/** A Tuesday, at a time of day that would be the previous day in UTC-5. */
const TUESDAY = new Date("2026-08-18T02:00:00.000Z");

/** The turn order for `TUESDAY`, whoever is up this week leading it. */
const queueFor = (now: Date) =>
  rotate(ROSTER, rotationIndex(currentMeetup(now), ROSTER.length));

describe("currentMeetup", () => {
  it("lands on the configured weekday at UTC midnight", () => {
    const date = currentMeetup(new Date("2026-08-13T09:00:00.000Z"));

    expect(date.getUTCDay()).toBe(MEETUP.weekday);
    expect(date.toISOString()).toBe("2026-08-18T00:00:00.000Z");
  });

  // The meetup is still "this week's" while it is happening — rolling over at
  // midnight would tell the person bringing the refreshments that their turn
  // is eight days away, on the morning they are meant to bring them.
  it("still counts meetup day itself as this week", () => {
    expect(currentMeetup(TUESDAY).toISOString()).toBe(
      "2026-08-18T00:00:00.000Z",
    );
  });

  it("moves on the day after", () => {
    expect(
      currentMeetup(new Date("2026-08-19T00:01:00.000Z")).toISOString(),
    ).toBe("2026-08-25T00:00:00.000Z");
  });
});

describe("lastMeetup", () => {
  // Meetup day counts as the last meetup too, for the same reason it counts as
  // this week's — that is the day a theme gets logged against.
  it("is meetup day itself while it is happening", () => {
    expect(lastMeetup(TUESDAY).toISOString()).toBe("2026-08-18T00:00:00.000Z");
  });

  it("is the previous meetup on any other day", () => {
    expect(
      lastMeetup(new Date("2026-08-19T00:01:00.000Z")).toISOString(),
    ).toBe("2026-08-18T00:00:00.000Z");
  });
});

describe("buildRotation", () => {
  it("gives one slot a week, starting with this week's", () => {
    const slots = buildRotation(TUESDAY, 3, queueFor(TUESDAY));

    expect(slots.map((slot) => slot.date)).toEqual([
      "2026-08-18T00:00:00.000Z",
      "2026-08-25T00:00:00.000Z",
      "2026-09-01T00:00:00.000Z",
    ]);
    expect(slots.map((slot) => slot.weeksAway)).toEqual([0, 1, 2]);
  });

  it("hands the turn to a different person every week", () => {
    const slots = buildRotation(TUESDAY, ROSTER.length, queueFor(TUESDAY));
    const ids = slots.map((slot) => slot.member.id);

    expect(new Set(ids).size).toBe(ROSTER.length);
  });

  // The whole point of anchoring to a date rather than storing a cursor: the
  // schedule is the same for everyone, and stays right through a quiet week.
  it("comes back round to the same person one lap later", () => {
    const lap = buildRotation(TUESDAY, ROSTER.length + 1, queueFor(TUESDAY));

    expect(lap[ROSTER.length].member.id).toBe(lap[0].member.id);
  });

  it("follows the queue it is handed, head on deck", () => {
    const spun = rotate(queueFor(TUESDAY), 3);
    const slots = buildRotation(TUESDAY, 2, spun);

    expect(slots[0].member).toBe(spun[0]);
    expect(slots[1].member).toBe(spun[1]);
  });
});

describe("rotate", () => {
  it("brings the chosen index to the front, keeping the cycle intact", () => {
    expect(rotate(["a", "b", "c", "d"], 2)).toEqual(["c", "d", "a", "b"]);
  });

  it("wraps rather than running off the end", () => {
    expect(rotate(["a", "b", "c"], 4)).toEqual(["b", "c", "a"]);
  });
});

describe("daysUntil", () => {
  it.each([
    ["2026-08-18T00:00:00.000Z", "היום"],
    ["2026-08-19T00:00:00.000Z", "מחר"],
    ["2026-08-20T00:00:00.000Z", "מחרתיים"],
    ["2026-08-21T00:00:00.000Z", "עוד 3 ימים"],
  ])("reads %s as %s", (iso, expected) => {
    expect(daysUntil(iso, TUESDAY)).toBe(expected);
  });
});
