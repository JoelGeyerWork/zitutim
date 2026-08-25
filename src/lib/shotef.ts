/**
 * השוטף — the on-call slot: whoever takes the bugs and the pages for a week.
 *
 * Everything here is hard-coded on purpose. This section is UI-first: the
 * shifts, the weekly reviews and the hall of fame are fixtures so the screens
 * can be judged before anything is stored. When it grows a database it splits
 * the way quotes and themes do — the types and the pure date math stay here (or
 * in a `shotef-schema.ts`), and a `server-only` Mongo layer re-exports them —
 * so nothing below imports `mongodb` or reaches for `server-only` today.
 *
 * Client-safe on purpose: the wheel is a client component.
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

/**
 * The roster, in turn order. Same eight people the seed writes into `users`, so
 * the mock reads like the real team rather than like test data.
 */
export const SHOTEF_ROSTER: Member[] = [
  { id: "noa", name: "נועה ברקת", role: "ראשת צוות", gender: "f" },
  { id: "itay", name: "איתי שרון", role: "שרת", gender: "m" },
  { id: "shira", name: "שירה לוי", role: "לקוח", gender: "f" },
  { id: "daniel", name: "דניאל עמר", role: "תשתיות", gender: "m" },
  { id: "tamar", name: "תמר רוזן", role: "בדיקות", gender: "f" },
  { id: "yonatan", name: "יונתן כץ", role: "שרת", gender: "m" },
  { id: "maya", name: "מאיה גלעד", role: "עיצוב מוצר", gender: "f" },
  { id: "ori", name: "אורי בן־חיים", role: "דאטה", gender: "m" },
];

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
  /** Index into `SHOTEF_ROSTER` by `id` — a real FK once this is stored. */
  memberId: string;
  /** 0–5. Zero is a real score: a week that went badly and is worth recording. */
  rating: number;
  /** One line, the way the week is remembered. */
  headline: string;
  body: string;
  /** How many issues reached the shotef that week — context for the score. */
  issues: number;
  /** Who wrote the review. Reviews are of the week, not of the person. */
  reviewedBy: string;
};

/** Newest week first — the list is read top-down and rarely scrolled far. */
export const SHOTEF_REVIEWS: ShotefReview[] = [
  {
    id: "w-2026-08-16",
    weekStart: "2026-08-16T00:00:00.000Z",
    memberId: "daniel",
    rating: 5,
    headline: "שבוע שקט שנגמר בשדרוג",
    body: "שתי תקלות קטנות, שתיהן נסגרו באותו יום. בין לבין דניאל ניקה את התראות הרעש שהצטברו בחודשים האחרונים — מאז יש חצי מהפינגים ואף אחד לא מתגעגע.",
    issues: 2,
    reviewedBy: "נועה ברקת",
  },
  {
    id: "w-2026-08-09",
    weekStart: "2026-08-09T00:00:00.000Z",
    memberId: "tamar",
    rating: 4,
    headline: "גל תקלות מהשחרור של יום שני",
    body: "השחרור הביא איתו שבע פניות ביומיים. תמר תיעדה כל אחת, זיהתה שכולן אותו באג ופתחה תיקון אחד במקום שבעה. ירד כוכב רק כי ההודעה לצוות יצאה באיחור.",
    issues: 7,
    reviewedBy: "איתי שרון",
  },
  {
    id: "w-2026-08-02",
    weekStart: "2026-08-02T00:00:00.000Z",
    memberId: "yonatan",
    rating: 3,
    headline: "שבוע בינוני, בעיקר בגלל התור",
    body: "ארבע פניות, כולן טופלו — אבל שתיים מהן חיכו יומיים כי לא היה ברור למי הן שייכות. הפתק שנשאר אחריו: להגדיר בעלות לפני שהתור מתמלא, לא אחרי.",
    issues: 4,
    reviewedBy: "נועה ברקת",
  },
  {
    id: "w-2026-07-26",
    weekStart: "2026-07-26T00:00:00.000Z",
    memberId: "shira",
    rating: 5,
    headline: "התקלה של הלקוח הגדול נסגרה תוך שעתיים",
    body: "פנייה דחופה נכנסה ברבע לחמש ביום רביעי. שירה שחזרה, מצאה, תיקנה ועדכנה את הלקוח לפני שהוא הספיק לשאול שוב. שאר השבוע היה שקט.",
    issues: 3,
    reviewedBy: "מאיה גלעד",
  },
  {
    id: "w-2026-07-19",
    weekStart: "2026-07-19T00:00:00.000Z",
    memberId: "ori",
    rating: 2,
    headline: "שבוע קשה, ולא באשמת אף אחד",
    body: "תשע פניות, שתי התראות לילה ותקלת רשת שלא הייתה שלנו בכלל. אורי החזיק את הראש מעל המים, אבל מהשבוע הזה יצאנו עם מסקנה אחת: שוטף אחד לא מספיק בשבוע שחרור גדול.",
    issues: 9,
    reviewedBy: "נועה ברקת",
  },
  {
    id: "w-2026-07-12",
    weekStart: "2026-07-12T00:00:00.000Z",
    memberId: "maya",
    rating: 4,
    headline: "רוב הפניות בכלל לא היו באגים",
    body: "חמש מתוך שש הפניות היו שאלות שימוש. מאיה ענתה, ואז כתבה מהן דף עזרה קצר שמאז חוסך לנו את אותן שאלות בדיוק.",
    issues: 6,
    reviewedBy: "תמר רוזן",
  },
];

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
   * Everyone whose name goes on the certificate, by `SHOTEF_ROSTER` id. Most
   * pages were not silenced alone — the shotef holds the ticket, but whoever
   * knew the subsystem is usually on the call too, and a wall that credits only
   * one of them is a wall people stop trusting.
   */
  solvedByIds: string[];
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

/** Newest first — the order the wall reads in. */
export const HALL_OF_FAME: SolvedMonitor[] = [
  {
    id: "m-db-ram",
    icon: "memory",
    monitor: "db-prod-01: RAM above 95%",
    solution:
      "לא דליפה — שאילתת דוח חודשית רצה בלי אינדקס ומשכה את כל הטבלה לזיכרון. הוספנו אינדקס מורכב על tenant ועל created_at, וזמן הריצה ירד מארבע דקות לשתי שניות. הזיכרון חזר ל-40% ולא עלה מאז.",
    solvedByIds: ["ori", "daniel"],
    firstFiredAt: "2026-06-09T00:00:00.000Z",
    solvedAt: "2026-08-18T00:00:00.000Z",
    minutesToFix: 180,
  },
  {
    id: "m-backup-stale",
    icon: "backup",
    monitor: "backup: last successful backup older than 48h",
    solution:
      "הגיבוי נכשל בשקט שלושה לילות אחרי ששינינו שם של דיסק — הסקריפט המשיך לדווח הצלחה כי בדק רק שהוא רץ, לא שהוא כתב. תיקנו את הנתיב, החלפנו את הבדיקה בקוד היציאה של המשימה, וגם שחזרנו גיבוי אחד כדי לוודא שיש מה לשחזר.",
    solvedByIds: ["daniel"],
    firstFiredAt: "2026-08-08T00:00:00.000Z",
    solvedAt: "2026-08-11T00:00:00.000Z",
    minutesToFix: 300,
  },
  {
    id: "m-queue-lag",
    icon: "loop",
    monitor: "ingest-queue: consumer lag > 10k",
    solution:
      "צרכן אחד נתקע על הודעה פגומה וניסה אותה שוב ושוב בלולאה אינסופית. הוספנו תור מכתבים־מתים אחרי שלושה ניסיונות, והפעם גם התראה על התור הזה — כדי שהודעה פגומה תהיה שקופה במקום להיות שקטה.",
    solvedByIds: ["yonatan", "itay"],
    firstFiredAt: "2026-08-05T00:00:00.000Z",
    solvedAt: "2026-08-06T00:00:00.000Z",
    minutesToFix: 2160,
  },
  {
    id: "m-tls-expiry",
    icon: "certificate",
    monitor: "gateway: TLS certificate expires in 3 days",
    solution:
      "חידוש ידני שאף אחד לא נזכר בו. חידשנו, ואז החלפנו את הזיכרון האנושי בקרון שמחדש 30 יום מראש ומדווח לערוץ. ההתראה נשארה — היא עכשיו רשת ביטחון ולא לוח שנה.",
    solvedByIds: ["daniel"],
    firstFiredAt: "2026-07-26T00:00:00.000Z",
    solvedAt: "2026-07-29T00:00:00.000Z",
    minutesToFix: 60,
  },
  {
    id: "m-5xx-spike",
    icon: "fire",
    monitor: "api: 5xx rate above 2% for 5m",
    solution:
      "שחרור שהוסיף שדה חובה לבקשה בלי לעדכן את האפליקציה בנייד. החזרנו לאחור תוך אחת־עשרה דקות, ואז שחררנו מחדש כששני הצדדים מסונכרנים. מאז שדה חובה חדש עובר קודם דרך שלב שבו הוא עדיין אופציונלי.",
    solvedByIds: ["itay", "yonatan"],
    firstFiredAt: "2026-07-21T00:00:00.000Z",
    solvedAt: "2026-07-21T00:00:00.000Z",
    minutesToFix: 11,
  },
  {
    id: "m-p95-latency",
    icon: "latency",
    monitor: "web: p95 latency above 2s",
    solution:
      "וידג׳ט חדש בדף הבית שאל את מסד הנתונים פעם אחת לכל שורה שהוא הציג — שמונים שאילתות בטעינה אחת. איחדנו אותן לשאילתה אחת, וה-p95 חזר מ-2.4 שניות ל-400 מילישניות.",
    solvedByIds: ["itay", "maya"],
    firstFiredAt: "2026-05-20T00:00:00.000Z",
    solvedAt: "2026-07-06T00:00:00.000Z",
    minutesToFix: 240,
  },
  {
    id: "m-disk-logs",
    icon: "disk",
    monitor: "app-03: disk usage above 90%",
    solution:
      "לוגים בלי סבב. פינינו, הגדרנו logrotate יומי עם שמירה לשבועיים, והורדנו את רמת הלוג של הבריאות מ-debug ל-info. תפוסת הדיסק יציבה על 55%.",
    solvedByIds: ["tamar"],
    firstFiredAt: "2026-06-16T00:00:00.000Z",
    solvedAt: "2026-06-30T00:00:00.000Z",
    minutesToFix: 120,
  },
  {
    id: "m-etl-nightly",
    icon: "pipeline",
    monitor: "etl: nightly export failed",
    solution:
      "המקור הוסיף עמודה, והטוען שלנו נפל על סכימה שלא הכיר. עכשיו הוא סופג עמודות שאינן מוכרות לו במקום ליפול, ומדווח עליהן בבוקר — טעינה שנכשלת היא בעיה, טעינה שמפתיעה היא רק ידיעה.",
    solvedByIds: ["ori"],
    firstFiredAt: "2026-06-13T00:00:00.000Z",
    solvedAt: "2026-06-22T00:00:00.000Z",
    minutesToFix: 90,
  },
  {
    id: "m-ldap-timeouts",
    icon: "network",
    monitor: "auth: LDAP bind timeouts",
    solution:
      "לא אנחנו — בקר תחום אחד מתוך שלושה יצא מהאוויר, והקליינט המשיך לנסות דווקא אותו. פנינו לתשתיות, ובינתיים קיצרנו את הטיים־אאוט וסידרנו מעבר לבקר הבא ברשימה. הכניסה נשארה עובדת גם כשבקר נופל.",
    solvedByIds: ["noa", "daniel"],
    firstFiredAt: "2026-06-10T00:00:00.000Z",
    solvedAt: "2026-06-11T00:00:00.000Z",
    minutesToFix: 240,
  },
  {
    id: "m-cache-stampede",
    icon: "cache",
    monitor: "cache: hit rate below 60%",
    solution:
      "כל המפתחות פגו באותה שנייה בדיוק, ואז כולם רצו יחד למסד הנתונים. פיזרנו את תוקף המפתחות באקראי בעד עשר אחוז, וההצלחה חזרה ל-94%.",
    solvedByIds: ["maya"],
    firstFiredAt: "2026-01-12T00:00:00.000Z",
    solvedAt: "2026-05-24T00:00:00.000Z",
    minutesToFix: 1440,
  },
  {
    id: "m-search-index",
    icon: "index",
    monitor: "search: index rebuild stuck for 6h",
    solution:
      "בנייה מחדש שרצה על אותו מסמך פגום עד אינסוף. דילגנו עליו, המשכנו את הבנייה, ואז הוספנו לה יומן התקדמות — מאז בנייה תקועה נראית תקועה תוך דקות במקום תוך חצי יום.",
    solvedByIds: ["ori", "tamar"],
    firstFiredAt: "2025-03-02T00:00:00.000Z",
    solvedAt: "2026-05-10T00:00:00.000Z",
    minutesToFix: 150,
  },
];

/**
 * Everyone named on a certificate, in the order they are written on it. Anyone
 * off the roster drops out rather than appearing nameless — the certificate is
 * still theirs, it just cannot say so.
 */
export function solversOf(monitor: SolvedMonitor): Member[] {
  return [...new Set(monitor.solvedByIds)].flatMap((id) => {
    const member = memberById(id);
    return member ? [member] : [];
  });
}

/** The roster row a review or a monitor points at, or undefined once removed. */
export function memberById(id: string): Member | undefined {
  return SHOTEF_ROSTER.find((member) => member.id === id);
}

/** Average stars across the reviews, to one decimal. Zero when there are none. */
export function averageRating(reviews: ShotefReview[]): number {
  if (reviews.length === 0) return 0;
  const total = reviews.reduce((sum, review) => sum + review.rating, 0);
  return Math.round((total / reviews.length) * 10) / 10;
}

/**
 * Newest first. Nothing on this wall outranks anything else — a monitor that
 * woke someone at 03:00 and one that only ever annoyed us are both a thing
 * somebody finished — so the only ordering left is when it was finished.
 */
export function byNewest(monitors: SolvedMonitor[]): SolvedMonitor[] {
  return [...monitors].sort((a, b) => b.solvedAt.localeCompare(a.solvedAt));
}

/** One row of the board: who has their name on how many plaques. */
export type Solver = {
  member: Member;
  solved: number;
  /** Newest save, for breaking a tie on form rather than on name order. */
  lastSolved: string;
};

/**
 * The people behind the wall, most plaques first. Anyone no longer on the
 * roster drops out rather than appearing nameless — their monitors keep their
 * plaques, which is where the record actually lives.
 */
export function solverBoard(monitors: SolvedMonitor[]): Solver[] {
  const board = new Map<string, Solver>();

  for (const monitor of monitors) {
    // Through a Set, so a name written twice on one certificate still counts
    // for one plaque — it is the certificates that are being counted here.
    for (const member of solversOf(monitor)) {
      const row = board.get(member.id);
      if (row) {
        row.solved += 1;
        if (monitor.solvedAt > row.lastSolved) row.lastSolved = monitor.solvedAt;
      } else {
        board.set(member.id, {
          member,
          solved: 1,
          lastSolved: monitor.solvedAt,
        });
      }
    }
  }

  return [...board.values()].sort(
    (a, b) => b.solved - a.solved || b.lastSolved.localeCompare(a.lastSolved),
  );
}

/** Whole days the monitor was firing before it was finally silenced. */
export function alertingDays(monitor: SolvedMonitor): number {
  const from = new Date(monitor.firstFiredAt).getTime();
  const to = new Date(monitor.solvedAt).getTime();
  return Math.max(0, Math.round((to - from) / (24 * 60 * 60 * 1000)));
}

/** The quickest save on the wall, or undefined on an empty one. */
export function fastestFix(monitors: SolvedMonitor[]): SolvedMonitor | undefined {
  return monitors.reduce<SolvedMonitor | undefined>(
    (best, monitor) =>
      !best || monitor.minutesToFix < best.minutesToFix ? monitor : best,
    undefined,
  );
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

/**
 * A validated input as a plaque on the wall. The id is generated here because
 * nothing stores these yet — when something does, it will hand back its own.
 */
export function newMonitor(input: MonitorInput): SolvedMonitor {
  return {
    id: `m-local-${crypto.randomUUID()}`,
    icon: input.icon,
    monitor: input.monitor,
    solution: input.solution,
    solvedByIds: input.solvedByIds,
    firstFiredAt: `${input.firstFiredAt}T00:00:00.000Z`,
    solvedAt: `${input.solvedAt}T00:00:00.000Z`,
    minutesToFix: input.minutesToFix,
  };
}
