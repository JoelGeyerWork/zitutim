/**
 * השוטף — the on-call slot: whoever takes the bugs and the pages for a week.
 *
 * The client-safe half of the section, exactly like `quote-schema.ts` and
 * `theme-schema.ts`: every type, every Zod schema, every pure date/maths helper
 * and every label map. No `server-only`, no `mongodb` — the wheel, the review
 * list and the hall of fame are all client components and import from *here*.
 * `src/lib/shotef.ts` is the `server-only` Mongo layer and re-exports all of it,
 * so server code can use the one import.
 *
 * None of the helpers below know a roster: membership is the `rotation`
 * collection now, so whatever still resolves a person against it is handed the
 * roster rather than closing over a list. The wall no longer resolves anybody
 * here at all — a certificate arrives carrying its solvers' names, joined from
 * `users` by the server, so a plaque keeps every name on it after its
 * recipients leave the rotation.
 */

import { z } from "zod";

import { dateOnly } from "@/lib/quote-schema";
import { type Member } from "@/lib/team";

const DAY_MS = 24 * 60 * 60 * 1000;
const WEEK_MS = 7 * DAY_MS;

/**
 * The shift changes hands on Sunday morning — the start of the working week
 * here, unlike the ישב״צ, which is anchored to its Tuesday. A shotef therefore
 * owns a whole Sunday-to-Saturday week rather than the span between meetups.
 */
export const HANDOVER_WEEKDAY = 0;

/**
 * The Sunday the member at index 0 opened. Anchoring to a date rather than
 * storing a cursor is what the ישב״צ rotation does, and for the same reason:
 * everyone loading the page sees the same schedule, and a week nobody opened
 * the app doesn't desynchronise it.
 */
const SHOTEF_ANCHOR = Date.UTC(2026, 0, 4);

/** Where to reach the shotef, and what they are expected to answer. */
export const SHOTEF = {
  /** Rendered after a hash icon, so the name carries no "#" of its own. */
  channel: "שוטף",
  /** Outside these, it is whoever is awake — the on-call slot is not a pager. */
  hours: "08:00–19:00",
} as const;

export type ShotefShift = {
  /** UTC midnight of the Sunday the shift opens — same shape as `saidAt`. */
  date: string;
  /** 0 is the shift running now, 1 the one after it. */
  weeksAway: number;
  member: Member;
};

/**
 * UTC midnight of the Sunday that opened the week now running. Deliberately
 * computed in UTC, like `currentMeetup`: these dates are rendered by the UTC
 * formatters in `format.ts`, so local-time arithmetic would show the wrong day
 * west of Greenwich.
 */
export function currentShift(now: Date): Date {
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const sinceHandover = (new Date(today).getUTCDay() - HANDOVER_WEEKDAY + 7) % 7;
  return new Date(today - sinceHandover * DAY_MS);
}

/** When the running shift is handed on — the Sunday that closes it. */
export function handoverOf(shiftIso: string): string {
  return new Date(new Date(shiftIso).getTime() + WEEK_MS).toISOString();
}

/** Whose week it is at `date`, as an index into a roster of `size` people. */
export function shiftIndex(date: Date, size: number): number {
  if (size <= 0) return 0;
  const weeks = Math.round((date.getTime() - SHOTEF_ANCHOR) / WEEK_MS);
  return ((weeks % size) + size) % size;
}

/**
 * The next `count` shifts, the running one first. `queue` is the turn order with
 * its head on duty — the wheel passes its own after a spin, so the queue behind
 * the winner keeps its cyclic order instead of being reshuffled.
 */
export function buildShifts(
  now: Date,
  count: number,
  queue: Member[],
): ShotefShift[] {
  // Nobody on duty is a real state now that the roster is editable and lives in
  // the database — an unseeded one has never had a member. `week % 0` is NaN,
  // so without this the caller gets a list of shifts with no member on them.
  if (queue.length === 0) return [];

  const first = currentShift(now);

  return Array.from({ length: count }, (_, week) => ({
    date: new Date(first.getTime() + week * WEEK_MS).toISOString(),
    weeksAway: week,
    member: queue[week % queue.length],
  }));
}

/** A week's report card. `rating` is whole stars, 0–5. */
export type ShotefReview = {
  id: string;
  /** UTC midnight of the Sunday that opened the week under review. */
  weekStart: string;
  /** The shotef whose week it was, as a `users._id` hex string. */
  memberId: string;
  /**
   * That person's name, resolved from `users` on read — never stored on the
   * review. A summary is a record of a week that happened, so it must not lose
   * its author the day they leave the on-call rotation; and resolving rather
   * than snapshotting means a rename in AD reaches every past week at once.
   * Same reasoning as `quote_comments`, which stores `authorId` and no name.
   * Empty only if the `users` row somehow vanished — the view says "לא ידוע".
   */
  memberName: string;
  /** 0–5. Zero is a real score: a week that went badly and is worth recording. */
  rating: number;
  /** One line, the way the week is remembered. */
  headline: string;
  body: string;
};

/**
 * What the reviews page reads: the list plus the aggregate that heads it.
 *
 * Here rather than in the `server-only` half because the page hands the whole
 * thing to a client component, which may not import `shotef-reviews.ts`.
 */
export type ShotefReviewList = {
  reviews: ShotefReview[];
  total: number;
  /** Mean stars across **every** review, to one decimal. Zero when there are none. */
  average: number;
};

/**
 * The face on the certificate's seal. The key is mapped to an icon in the view
 * — the data says what the fix was *about*, not which component draws it, so a
 * redesign doesn't have to rewrite the hall.
 */
export const AWARD_ICONS = [
  "memory",
  "loop",
  "certificate",
  "fire",
  "disk",
  "network",
  "cache",
  "backup",
  "latency",
  "pipeline",
  "index",
] as const;

export type AwardIcon = (typeof AWARD_ICONS)[number];

/** What each seal is called in the picker. The view owns which glyph it draws. */
export const AWARD_ICON_LABELS: Record<AwardIcon, string> = {
  memory: "זיכרון",
  loop: "לולאה",
  certificate: "תעודות",
  fire: "שריפה",
  disk: "דיסק",
  network: "רשת",
  cache: "מטמון",
  backup: "גיבוי",
  latency: "זמני תגובה",
  pipeline: "צינור נתונים",
  index: "אינדקס",
};

/**
 * One name on a certificate, resolved from `users` when the wall is read.
 *
 * A name rather than an id alone, and resolved on read rather than snapshotted:
 * this is the `quote_comments` rule. `users` rows are never deleted — leaving
 * the on-call rotation does not remove the user — so the name is always
 * resolvable, a rename in the directory reaches every plaque at once, and a
 * certificate cannot lose a recipient because the roster changed after it was
 * earned.
 */
export type MonitorSolver = {
  /** `users._id` as a hex string — the same row a theme or a review points at. */
  id: string;
  name: string;
};

/** A monitor that fired, and what it took to make it stop. */
export type SolvedMonitor = {
  id: string;
  icon: AwardIcon;
  /**
   * The monitor as it is spelled in the alerting system — quoted verbatim, and
   * the certificate's own title: what is being honoured here is the thing that
   * used to fire, so the wall is searchable by the string people actually saw.
   */
  monitor: string;
  /** How it was actually solved. The point of the whole page. */
  solution: string;
  /**
   * Everyone whose name goes on the certificate, already resolved to a name by
   * the server. Most pages were not silenced alone — the shotef holds the
   * ticket, but whoever knew the subsystem is usually on the call too, and a
   * wall that credits only one of them is a wall people stop trusting.
   *
   * Resolved rather than stored as bare ids the view has to look up in the
   * rotation: the rotation is who is on call *now*, and a plaque that consults
   * it loses a name the day its recipient leaves. The rotation gates the wheel
   * and the podium, which is all it is the right authority for.
   */
  solvedBy: MonitorSolver[];
  /**
   * UTC midnight of the day the monitor first fired. Half the story of a
   * plaque is how long the thing was allowed to scream before anybody fixed
   * it — a page that woke someone once is not the same save as one the team
   * had been dismissing since spring.
   */
  firstFiredAt: string;
  /** UTC midnight of the day it was closed. */
  solvedAt: string;
  /** Wall-clock minutes from the page to the fix. Rendered by `formatDuration`
   *  rather than written out, so "the fastest one" is something we can compute
   *  instead of something we have to keep in agreement by hand. */
  minutesToFix: number;
};

/**
 * Everyone named on a certificate, in the order they are written on it.
 *
 * No roster: a plaque is a record of something that happened, and every name on
 * it renders whether or not that person is still on the on-call rotation. All
 * this does is fold out a name written twice — the schema dedupes before a
 * write, so only a document that predates it can arrive doubled, and the view
 * keys its list on the id.
 */
export function solversOf(monitor: SolvedMonitor): MonitorSolver[] {
  const seen = new Set<string>();
  return monitor.solvedBy.filter((solver) => {
    if (seen.has(solver.id)) return false;
    seen.add(solver.id);
    return true;
  });
}

/** Average stars across the reviews, to one decimal. Zero when there are none. */
export function averageRating(reviews: ShotefReview[]): number {
  if (reviews.length === 0) return 0;
  const total = reviews.reduce((sum, review) => sum + review.rating, 0);
  return Math.round((total / reviews.length) * 10) / 10;
}

/** Newest week first, whatever order they arrived in. */
export function byWeek(reviews: ShotefReview[]): ShotefReview[] {
  return [...reviews].sort((a, b) => b.weekStart.localeCompare(a.weekStart));
}

/**
 * The last `count` weeks that have *closed*, newest first — what a review can
 * be written about. The running week is left out deliberately: it has no score
 * yet, and the earliest it can get one is the Sunday it hands over.
 */
export function closedWeeks(now: Date, count: number): string[] {
  const lastClosed = currentShift(now).getTime() - WEEK_MS;

  return Array.from({ length: count }, (_, back) =>
    new Date(lastClosed - back * WEEK_MS).toISOString(),
  );
}

/** Whose week it was, per the anchored rotation — the review's default author. */
export function shotefOn(weekStartIso: string, roster: Member[]): Member | undefined {
  return roster[shiftIndex(new Date(weekStartIso), roster.length)];
}

/** A star count, and what it is worth saying about it in the picker. */
export const RATING_LABELS: Record<number, string> = {
  0: "שבוע שלא נשמור למזכרת",
  1: "היה קשה",
  2: "היו ימים טובים יותר",
  3: "שבוע סביר",
  4: "שבוע טוב",
  5: "שבוע מופתי",
};

export const reviewInputSchema = z.object({
  // A shift is a whole Sunday-to-Saturday week, so a week that doesn't start on
  // one is not a week anyone was on duty for. The form only offers Sundays; the
  // check is here because this is the shape a route handler would trust.
  weekStart: dateOnly.refine(
    (value) => new Date(value).getUTCDay() === HANDOVER_WEEKDAY,
    "שבוע תורנות מתחיל ביום ראשון",
  ),
  memberId: z.string().min(1, "צריך לבחור מי היה השוטף"),
  // Zero is a legal score, so this is `min(0)` rather than `positive()` — a week
  // that went badly is exactly the one worth writing down.
  rating: z
    .number("צריך לתת ציון")
    .int("צריך מספר שלם")
    .min(0, "הציון מתחיל באפס")
    .max(5, "הציון נגמר בחמש"),
  headline: z
    .string()
    .trim()
    .min(3, "צריך משפט אחד שמסכם את השבוע")
    .max(80, "הכותרת ארוכה מדי"),
  body: z
    .string()
    .trim()
    .min(10, "צריך לכתוב מה קרה בשבוע הזה")
    .max(800, "הסיכום ארוך מדי"),
});

export type ReviewInput = z.infer<typeof reviewInputSchema>;

/**
 * Newest first. Nothing on this wall outranks anything else — a monitor that
 * woke someone at 03:00 and one that only ever annoyed us are both a thing
 * somebody finished — so the only ordering left is when it was finished.
 */
export function byNewest(monitors: SolvedMonitor[]): SolvedMonitor[] {
  return [...monitors].sort((a, b) => b.solvedAt.localeCompare(a.solvedAt));
}

/**
 * One row of the podium: who has their name on how many plaques.
 *
 * Only the type is here. The board itself is `getSolverBoard` in
 * `shotef-monitors.ts`, counted across the whole collection by the database —
 * the `getStandings` rule, and for the same reason: a leaderboard reduced over
 * whatever list a client happens to hold is silently wrong the day that list
 * stops being all of it, and a hall of fame only ever grows. There is no pure
 * second spelling of it to keep in agreement.
 *
 * `member` is a `Member`, not a `MonitorSolver`, because the podium *is* the
 * current rotation ranked — it carries the role and the gender a plaque cannot,
 * since those live on the rotation document rather than on the `users` row.
 */
export type Solver = {
  member: Member;
  solved: number;
  /** Newest save, for breaking a tie on form rather than on name order. */
  lastSolved: string;
};

/**
 * What the hall-of-fame page reads: the wall plus the two numbers beside it.
 *
 * Here rather than in the `server-only` half, for the same reason
 * `ShotefReviewList` is: the page hands the whole thing to a client component,
 * which may not import `shotef-monitors.ts`.
 *
 * Both aggregates are collection-wide and arrive already computed — the client
 * has no pure second spelling of either, deliberately, so there is nothing to
 * keep in agreement and no way for the podium to be a reduction over a partial
 * list.
 */
export type MonitorWall = {
  monitors: SolvedMonitor[];
  board: Solver[];
  /** Null on an empty wall — there is no quickest save to name. */
  fastest: SolvedMonitor | null;
};

/** Whole days the monitor was firing before it was finally silenced. */
export function alertingDays(monitor: SolvedMonitor): number {
  const from = new Date(monitor.firstFiredAt).getTime();
  const to = new Date(monitor.solvedAt).getTime();
  return Math.max(0, Math.round((to - from) / (24 * 60 * 60 * 1000)));
}

/**
 * What the add form collects. Validation lives here rather than in the dialog
 * for the same reason the other sections keep theirs in a schema module: it is
 * the shape a route handler will re-validate the day this stops being local,
 * and it is testable without rendering anything.
 */
export const monitorInputSchema = z
  .object({
    monitor: z
      .string()
      .trim()
      .min(3, "צריך לכתוב איך המוניטור נקרא")
      .max(120, "השם ארוך מדי"),
    icon: z.enum(AWARD_ICONS),
    solution: z
      .string()
      .trim()
      .min(10, "צריך לכתוב איך פתרתם את זה")
      .max(1200, "ההסבר ארוך מדי"),
    solvedByIds: z
      .array(z.string())
      // Through a Set: the form cannot send a name twice, but the schema is
      // what a route handler would trust, and that one can be sent anything.
      .transform((ids) => [...new Set(ids)])
      .refine((ids) => ids.length > 0, "צריך לבחור לפחות אדם אחד"),
    firstFiredAt: dateOnly,
    solvedAt: dateOnly,
    minutesToFix: z
      .number("צריך למלא כמה זמן זה לקח")
      .int("צריך מספר שלם")
      .positive("צריך מספר גדול מאפס")
      .max(60 * 24 * 365, "זה כבר לא זמן טיפול"),
  })
  // A monitor cannot be silenced before it first fired, and the certificate
  // renders the span between the two — so it is caught here, not on the wall.
  .refine((input) => input.firstFiredAt <= input.solvedAt, {
    path: ["firstFiredAt"],
    error: "המוניטור לא יכול להיפתר לפני שהוא צעק",
  });

export type MonitorInput = z.infer<typeof monitorInputSchema>;
