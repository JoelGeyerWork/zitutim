import { describe, expect, it } from "vitest";

import {
  buildRotation,
  currentMeetup,
  currentQueue,
  daysUntil,
  MEETUP,
  rotate,
  TEAM,
} from "@/lib/team";

/** A Tuesday, at a time of day that would be the previous day in UTC-5. */
const TUESDAY = new Date("2026-08-18T02:00:00.000Z");

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

describe("buildRotation", () => {
  it("gives one slot a week, starting with this week's", () => {
    const slots = buildRotation(TUESDAY, 3);

    expect(slots.map((slot) => slot.date)).toEqual([
      "2026-08-18T00:00:00.000Z",
      "2026-08-25T00:00:00.000Z",
      "2026-09-01T00:00:00.000Z",
    ]);
    expect(slots.map((slot) => slot.weeksAway)).toEqual([0, 1, 2]);
  });

  it("hands the turn to a different person every week", () => {
    const slots = buildRotation(TUESDAY, TEAM.length);
    const names = slots.map((slot) => slot.member.id);

    expect(new Set(names).size).toBe(TEAM.length);
  });

  // The whole point of anchoring to a date rather than storing a cursor: the
  // schedule is the same for everyone, and stays right through a quiet week.
  it("comes back round to the same person one lap later", () => {
    const lap = buildRotation(TUESDAY, TEAM.length + 1);

    expect(lap[TEAM.length].member.id).toBe(lap[0].member.id);
  });

  it("follows the queue it is handed, head on deck", () => {
    const spun = rotate(currentQueue(TUESDAY), 3);
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
