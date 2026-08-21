/**
 * The team and the weekly ישב״צ, hard-coded for now.
 *
 * Everything here is client-safe on purpose — no `server-only`, no database.
 * When this moves to Mongo the shapes below become the collection documents
 * and `buildRotation` becomes a query; the components should not have to care.
 */

export type Member = {
  id: string;
  name: string;
  role: string;
  /** Hebrew conjugates the verb, so "מביא"/"מביאה" needs to know. */
  gender: "m" | "f";
};

export const TEAM: Member[] = [
  { id: "noa", name: "נועה ברקת", role: "ראשת צוות", gender: "f" },
  { id: "itay", name: "איתי שרון", role: "שרת", gender: "m" },
  { id: "shira", name: "שירה לוי", role: "לקוח", gender: "f" },
  { id: "daniel", name: "דניאל עמר", role: "תשתיות", gender: "m" },
  { id: "tamar", name: "תמר רוזן", role: "בדיקות", gender: "f" },
  { id: "yonatan", name: "יונתן כץ", role: "שרת", gender: "m" },
  { id: "maya", name: "מאיה גלעד", role: "עיצוב מוצר", gender: "f" },
  { id: "ori", name: "אורי בן־חיים", role: "דאטה", gender: "m" },
];

export const MEETUP = {
  /** 0 = Sunday. The week starts on Sunday here, so 2 is Tuesday. */
  weekday: 2,
  time: "09:30",
  place: "חדר ישיבות ב׳",
} as const;

/**
 * The meetup at which `TEAM[0]` brought the refreshments — a Tuesday. Anchoring
 * the rotation to a date rather than storing "whose turn is it" means the
 * schedule is the same for everyone who loads the page, and stays right through
 * any week nobody opened the app.
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

export function memberById(id: string): Member | undefined {
  return TEAM.find((member) => member.id === id);
}

/** Whose turn the rotation says it was — or will be — on a given meetup date. */
export function memberOn(date: Date): Member {
  return TEAM[rotationIndex(date)];
}

/**
 * Whose turn it is at `date`, as an index into a rotation of `size` people.
 * `size` is a parameter because the roster is editable: the number of people in
 * the rotation is not a constant of the app the way `TEAM.length` was.
 */
export function rotationIndex(date: Date, size: number = TEAM.length): number {
  if (size <= 0) return 0;
  const weeks = Math.round((date.getTime() - ROTATION_ANCHOR) / WEEK_MS);
  return ((weeks % size) + size) % size;
}

/** The team in turn order for `now` — whoever is up this week leads it. */
export function currentQueue(now: Date): Member[] {
  return rotate(TEAM, rotationIndex(currentMeetup(now)));
}

/**
 * The next `count` meetups, this week's first. `queue` is the turn order, its
 * head on deck — the roulette passes its own after a spin, where the queue
 * behind the winner keeps its cyclic order rather than being reshuffled.
 */
export function buildRotation(
  now: Date,
  count: number,
  queue: Member[] = currentQueue(now),
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
