/**
 * The weekly ישב״צ: pure meetup date-math plus rotation math over a roster the
 * caller supplies.
 *
 * The roster no longer lives here. Identity and order are the `rotation`
 * collection (see `rotation.ts`); `rotationIndex`, `rotate` and `buildRotation`
 * are given the members and their count as arguments and hold no list of their
 * own. That is what keeps this module client-safe — no `server-only`, no
 * database — while the source of truth stays server-side.
 */

export type Member = {
  id: string;
  name: string;
  role: string;
  /** Hebrew conjugates the verb, so "מביא"/"מביאה" needs to know. */
  gender: "m" | "f";
};

export const MEETUP = {
  /** 0 = Sunday. The week starts on Sunday here, so 2 is Tuesday. */
  weekday: 2,
  time: "09:30",
  place: "חדר ישיבות ב׳",
} as const;

/**
 * The meetup at which the member at rotation index 0 brought the refreshments —
 * a Tuesday. Anchoring the rotation to a date rather than storing "whose turn is
 * it" means the schedule is the same for everyone who loads the page, and stays
 * right through any week nobody opened the app.
 */
const ROTATION_ANCHOR = Date.UTC(2026, 0, 6);

const DAY_MS = 24 * 60 * 60 * 1000;
const WEEK_MS = 7 * DAY_MS;

export type MeetupSlot = {
  /** UTC midnight, ISO — the same shape (and timezone) as a quote's `saidAt`. */
  date: string;
  /** 0 is the meetup this week, 1 the one after it. */
  weeksAway: number;
  member: Member;
};

/**
 * UTC midnight of the coming meetup, counting today as "this week's" for the
 * whole of meetup day itself. Deliberately computed in UTC, like `saidAt` in
 * `format.ts`: the date is rendered by `formatSaidAt`, which formats in UTC, so
 * doing the arithmetic in local time would render the wrong day west of
 * Greenwich.
 */
export function currentMeetup(now: Date): Date {
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const untilMeetup = (MEETUP.weekday - new Date(today).getUTCDay() + 7) % 7;
  return new Date(today + untilMeetup * DAY_MS);
}

/**
 * The most recent meetup that has already happened — meetup day itself counts,
 * for the same reason `currentMeetup` does. This is the one a theme gets logged
 * against, since you cannot guess a theme that hasn't been brought yet.
 */
export function lastMeetup(now: Date): Date {
  const next = currentMeetup(now);
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return next.getTime() === today ? next : new Date(next.getTime() - WEEK_MS);
}

/**
 * Whose turn it is at `date`, as an index into a rotation of `size` people.
 * `size` is required because the roster is editable and lives in the database:
 * the caller reads the rotation and passes its length, since the count is no
 * longer a constant of the app.
 */
export function rotationIndex(date: Date, size: number): number {
  if (size <= 0) return 0;
  const weeks = Math.round((date.getTime() - ROTATION_ANCHOR) / WEEK_MS);
  return ((weeks % size) + size) % size;
}

/**
 * The next `count` meetups, this week's first. `queue` is the turn order, its
 * head on deck — the roulette passes its own after a spin, where the queue
 * behind the winner keeps its cyclic order rather than being reshuffled. The
 * caller supplies it because the roster is server-side; there is no default.
 */
export function buildRotation(
  now: Date,
  count: number,
  queue: Member[],
): MeetupSlot[] {
  const first = currentMeetup(now);

  return Array.from({ length: count }, (_, week) => ({
    date: new Date(first.getTime() + week * WEEK_MS).toISOString(),
    weeksAway: week,
    member: queue[week % queue.length],
  }));
}

/** Rotate a list so `from` leads it, keeping everyone else in the same cycle. */
export function rotate<T>(list: T[], from: number): T[] {
  const at = ((from % list.length) + list.length) % list.length;
  return [...list.slice(at), ...list.slice(0, at)];
}

/** "היום" / "מחר" / "עוד 3 ימים" — meetups are never in the past here. */
export function daysUntil(iso: string, now: Date): string {
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const days = Math.round((new Date(iso).getTime() - today) / DAY_MS);

  if (days <= 0) return "היום";
  if (days === 1) return "מחר";
  if (days === 2) return "מחרתיים";
  return `עוד ${days} ימים`;
}

/** "מביא"/"מביאה" and friends, picked by the member's grammatical gender. */
export function conjugate(member: Member, masculine: string, feminine: string) {
  return member.gender === "f" ? feminine : masculine;
}
