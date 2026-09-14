import Link from "next/link";
import { ArrowLeftIcon } from "lucide-react";

import { HubHero } from "@/components/hub-hero";
import { PersonAvatar } from "@/components/person-avatar";
import { formatMeetupDate, greetingName, plural } from "@/lib/format";
import { SECTIONS, type Section } from "@/lib/navigation";
import { type RosterMember } from "@/lib/roster";
import { getRotation } from "@/lib/rotation";
import {
  currentShift,
  getShotefRotation,
  handoverOf,
  shiftIndex,
} from "@/lib/shotef";
import {
  conjugate,
  currentMeetup,
  daysUntil,
  MEETUP,
  rotationIndex,
} from "@/lib/team";
import { getSession } from "@/lib/session";
import { getStats, listQuotes } from "@/lib/quotes";
import { cn } from "@/lib/utils";

export const dynamic = "force-dynamic";

/**
 * The landing page. It is the one route that is not a section, so it does not
 * wear `PageShell` — a hero wants to bleed to the viewport edge — but its
 * content column is the header's own `max-w-2xl`, so the wordmark, the
 * headline and the cards all share one left edge.
 */
export default async function HubPage() {
  const now = new Date();

  const [user, stats, latest, roster, onCallRoster] = await Promise.all([
    getSession(),
    getStats(),
    listQuotes({ limit: 1 }),
    getRotation(),
    getShotefRotation(),
  ]);

  // This week's slot straight off the DB-backed rotation, in stored order — the
  // same anchored index the roulette uses. Empty on an unseeded database, where
  // the card falls back to the section description rather than crashing.
  const thisWeek =
    roster.length > 0
      ? {
          member: roster[rotationIndex(currentMeetup(now), roster.length)],
          date: currentMeetup(now).toISOString(),
        }
      : null;

  // The same anchored index the on-call wheel uses, over the same stored
  // rotation. Empty on an unseeded database, where this card falls back to the
  // section description rather than crashing — exactly like the meetup one.
  const shift = currentShift(now);
  const onCall =
    onCallRoster.length > 0
      ? onCallRoster[shiftIndex(shift, onCallRoster.length)]
      : null;

  /**
   * What each section shows on its card. A section with nothing registered
   * still gets a card — its description and a way in — so adding one to
   * `SECTIONS` is enough to make it appear here, and a teaser can follow later.
   */
  const teasers: Record<string, Teaser> = {
    "/meetups": thisWeek
      ? {
          content: <MeetupTeaser member={thisWeek.member} date={thisWeek.date} now={now} />,
        }
      : {},
    "/shotef": onCall
      ? {
          content: (
            <ShotefTeaser
              member={onCall}
              handover={handoverOf(shift.toISOString())}
              now={now}
            />
          ),
        }
      : {},
    "/quotes": { content: <QuoteTeaser stats={stats} quote={latest.quotes[0]} /> },
  };

  const firstName = greetingName(user?.name);

  return (
    <>
      <HubHero firstName={firstName} />

      {/* The two weekly rotations share the first row — they lead `SECTIONS`
          because they are the things here that expire — and anything after
          them runs full width, so a fourth section lands in a sensible place
          without this grid being revisited. */}
      <section className="mx-auto grid w-full min-w-0 max-w-2xl gap-4 px-4 pt-4 sm:grid-cols-2 sm:pt-6">
          {SECTIONS.map((section, index) => (
            <SectionCard
              key={section.href}
              section={section}
              className={cn(index >= 2 && "sm:col-span-2")}
            >
              {teasers[section.href]?.content}
            </SectionCard>
          ))}
      </section>
    </>
  );
}

// `content` is optional: an empty rotation registers a teaser with neither
// field, so the card falls back to the section description like any section
// with nothing registered.
type Teaser = { content?: React.ReactNode };

/** A whole section as one click target — the hub is a list of front doors. */
function SectionCard({
  section,
  className,
  children,
}: {
  section: Section;
  className?: string;
  children?: React.ReactNode;
}) {
  return (
    <Link
      href={section.href}
      className={cn(
        "group bg-card/70 hover:border-primary/40 hover:shadow-primary/30 flex min-w-0 flex-col rounded-2xl border p-5 backdrop-blur transition-all hover:-translate-y-0.5 hover:shadow-[0_28px_60px_-32px]",
        className,
      )}
    >
      <div className="flex items-center gap-3">
        <span className="bg-primary/10 text-primary ring-primary/15 flex size-10 shrink-0 items-center justify-center rounded-xl ring-1">
          <section.icon className="size-5" />
        </span>
        <p className="min-w-0 flex-1 truncate text-lg font-bold">{section.label}</p>
        {/* Deliberately not flipped: in RTL, "onward" points left. */}
        <ArrowLeftIcon className="text-muted-foreground group-hover:text-primary size-4 transition-all group-hover:-translate-x-0.5" />
      </div>

      {children ?? (
        <p className="text-muted-foreground mt-4 text-sm">{section.description}</p>
      )}
    </Link>
  );
}

function MeetupTeaser({
  member,
  date,
  now,
}: {
  // The whole slot is computed on the server page from `getRotation()`; the
  // teaser only renders it, so it stays a plain display component.
  member: RosterMember;
  date: string;
  now: Date;
}) {
  return (
    <>
      <div className="mt-4 flex items-center gap-3">
        <PersonAvatar name={member.name} className="size-12 text-lg" />
        <div className="min-w-0 flex-1">
          <p className="truncate font-semibold">{member.name}</p>
          <p className="text-muted-foreground text-sm">
            {conjugate(member, "מביא", "מביאה")} את הכיבוד ·{" "}
            {daysUntil(date, now)}
          </p>
        </div>
      </div>

      <p className="text-muted-foreground mt-4 border-t pt-3 text-sm">
        {formatMeetupDate(date)}, {MEETUP.time} · {MEETUP.place}
      </p>
    </>
  );
}

function ShotefTeaser({
  member,
  handover,
  now,
}: {
  // Resolved on the server page off `getShotefRotation()`; the teaser only
  // renders it, so it stays a plain display component like the meetup one.
  member: RosterMember;
  /** When the shift is handed on — on duty, that is the date that matters. */
  handover: string;
  now: Date;
}) {
  return (
    <div className="mt-4 flex items-center gap-3">
      <PersonAvatar name={member.name} className="size-12 text-lg" />
      <div className="min-w-0 flex-1">
        <p className="truncate font-semibold">{member.name}</p>
        <p className="text-muted-foreground text-sm">
          {conjugate(member, "אחראי", "אחראית")} על הבאגים · הסבב עובר{" "}
          {daysUntil(handover, now)}
        </p>
      </div>
    </div>
  );
}

function QuoteTeaser({
  stats,
  quote,
}: {
  stats: { total: number };
  quote?: { text: string; author: string };
}) {
  if (!quote) {
    return (
      <p className="text-muted-foreground mt-4 text-sm">
        מישהו בטוח אמר משהו שראוי להישמר. תהיו הראשונים לתעד.
      </p>
    );
  }

  // The wall's latest, set like a testimonial: this card runs full width, so
  // it can afford the measure.
  return (
    <figure className="mt-4">
      <blockquote className="relative ps-6">
        <span
          aria-hidden
          className="quote-mark text-primary/30 absolute -top-2 start-0 text-4xl"
        >
          ״
        </span>
        <p className="wrap-anywhere line-clamp-3 text-lg leading-relaxed font-medium text-pretty">
          {quote.text}
        </p>
      </blockquote>
      <figcaption className="text-muted-foreground mt-3 wrap-anywhere ps-6 text-sm">
        — {quote.author} · {plural(stats.total, "ציטוט אחד", "ציטוטים")} בקיר
      </figcaption>
    </figure>
  );
}
