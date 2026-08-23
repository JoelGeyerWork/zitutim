const LOCALE = "he-IL";

/**
 * `saidAt` is stored at UTC midnight, so it must be *formatted* in UTC too —
 * otherwise a negative-offset timezone would render the previous day.
 */
const fullDate = new Intl.DateTimeFormat(LOCALE, {
  day: "numeric",
  month: "long",
  year: "numeric",
  timeZone: "UTC",
});

const shortDate = new Intl.DateTimeFormat(LOCALE, {
  day: "numeric",
  month: "short",
  year: "numeric",
  timeZone: "UTC",
});

/** "יום שלישי, 18 באוגוסט" — a meetup is found by weekday, not by year. */
const meetupDate = new Intl.DateTimeFormat(LOCALE, {
  weekday: "long",
  day: "numeric",
  month: "long",
  timeZone: "UTC",
});

/** The two halves of a week range — "16" and "22 באוגוסט". */
const dayOnly = new Intl.DateTimeFormat(LOCALE, {
  day: "numeric",
  timeZone: "UTC",
});

const dayMonth = new Intl.DateTimeFormat(LOCALE, {
  day: "numeric",
  month: "long",
  timeZone: "UTC",
});

export function formatSaidAt(iso: string): string {
  return fullDate.format(new Date(iso));
}

export function formatMeetupDate(iso: string): string {
  return meetupDate.format(new Date(iso));
}

export function formatSaidAtShort(iso: string): string {
  return shortDate.format(new Date(iso));
}

/**
 * "16–22 באוגוסט" for a week that starts at `iso` — a shotef shift is a span,
 * and naming only its first day reads as a single date. The month is spelled
 * once when both ends share it. UTC throughout, like every formatter here.
 */
export function formatWeekRange(iso: string): string {
  const start = new Date(iso);
  const end = new Date(start.getTime() + 6 * 24 * 60 * 60 * 1000);

  return start.getUTCMonth() === end.getUTCMonth()
    ? `${dayOnly.format(start)}–${dayMonth.format(end)}`
    : `${dayMonth.format(start)} – ${dayMonth.format(end)}`;
}

/** "30 באוגוסט" — a single day, where a whole range would not fit. */
export function formatDayMonth(iso: string): string {
  return dayMonth.format(new Date(iso));
}

const relative = new Intl.RelativeTimeFormat(LOCALE, { numeric: "auto" });

const UNITS: [Intl.RelativeTimeFormatUnit, number][] = [
  ["year", 365 * 24 * 60 * 60 * 1000],
  ["month", 30 * 24 * 60 * 60 * 1000],
  ["week", 7 * 24 * 60 * 60 * 1000],
  ["day", 24 * 60 * 60 * 1000],
  ["hour", 60 * 60 * 1000],
  ["minute", 60 * 1000],
];

/** "לפני 3 ימים" — used for when the quote was *added*, not when it was said. */
export function formatRelative(iso: string): string {
  const diff = new Date(iso).getTime() - Date.now();
  const abs = Math.abs(diff);

  if (abs < 60 * 1000) return "עכשיו";

  for (const [unit, ms] of UNITS) {
    if (abs >= ms) {
      return relative.format(Math.round(diff / ms), unit);
    }
  }
  return "עכשיו";
}

/** Today as YYYY-MM-DD in the viewer's own timezone — for date input defaults. */
export function todayInputValue(): string {
  const now = new Date();
  const local = new Date(now.getTime() - now.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 10);
}

/** ISO timestamp -> YYYY-MM-DD, for pre-filling a date input when editing. */
export function toInputValue(iso: string): string {
  return new Date(iso).toISOString().slice(0, 10);
}

/**
 * Hebrew counts read badly with a bare numeral at 1 ("1 תוצאות"), so the
 * singular gets its own wording. Two is close enough to the plural form here.
 */
export function plural(count: number, one: string, many: string): string {
  return count === 1 ? one : `${count} ${many}`;
}

/** First letter of a name, for the avatar fallback. */
export function initial(name: string): string {
  return name.trim().charAt(0).toUpperCase() || "?";
}

/** Deterministic hue-free tint per author so avatars aren't all identical. */
export function authorTone(name: string): number {
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = (hash * 31 + name.charCodeAt(i)) >>> 0;
  }
  return hash % 5;
}
