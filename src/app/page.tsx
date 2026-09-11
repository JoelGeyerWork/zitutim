import Link from "next/link";
import { ArrowLeftIcon } from "lucide-react";

import { PersonAvatar } from "@/components/person-avatar";
import { RedDiamond } from "@/components/red-diamond";
import { formatMeetupDate, plural } from "@/lib/format";
import { HUB, SECTIONS, type Section } from "@/lib/navigation";
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

  const firstName = user ? user.name.split(" ")[0] : "צוות";

  return (
    <>
      <section className="relative isolate">
        <Backdrop />

        <div className="mx-auto flex max-w-2xl flex-col items-center gap-6 px-4 pt-8 pb-6 text-center sm:flex-row sm:gap-10 sm:pt-14 sm:pb-10 sm:text-start">
          <div className="min-w-0 flex-1">
            {/* Not the app's name — the wordmark in the header already says
                that. */}
            <h1 className="text-4xl font-black tracking-tight sm:text-5xl">
              היי,{" "}
              <span className="hub-name from-primary to-chart-3 bg-linear-to-l bg-clip-text text-transparent">
                {firstName}
              </span>
              .
            </h1>
            <p className="text-muted-foreground mt-3 text-lg">{HUB.description}</p>
          </div>

          {/* Leads on a phone, where the column stacks: the stone is the
              page's idea, and the greeting reads better under it than over
              it. Beside the text once there is room for both. */}
          <RedDiamond
            size="clamp(112px, 28vw, 150px)"
            className="shrink-0 max-sm:order-first"
          />
        </div>
      </section>

      {/* The two weekly rotations share the first row — they lead `SECTIONS`
          because they are the things here that expire — and anything after
          them runs full width, so a fourth section lands in a sensible place
          without this grid being revisited. */}
      <section className="mx-auto grid max-w-2xl gap-4 px-4 pt-4 sm:grid-cols-2 sm:pt-6">
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

/**
 * The hero's ground: a faint grid fading out from the middle, and one red glow
 * behind the stone. Both are static CSS — the gem is the only thing on this
 * page that is allowed to keep moving.
 *
 * The clip lives here and not on the section. The glow is far larger than the
 * hero and has to be cut somewhere, but an `overflow` on the section would cut
 * the stone too — perspective swells its near corner past the stage, and the
 * float carries it a few pixels further — and on WebKit a clipping ancestor
 * can flatten a `preserve-3d` descendant, which would put every frame back on
 * the raster path the layer promotion exists to avoid.
 */
function Backdrop() {
  return (
    <div aria-hidden className="absolute inset-0 -z-10 overflow-hidden">
      <div className="absolute inset-0 bg-[linear-gradient(to_right,var(--border)_1px,transparent_1px),linear-gradient(to_bottom,var(--border)_1px,transparent_1px)] bg-[size:32px_32px] [mask-image:radial-gradient(ellipse_70%_80%_at_50%_30%,black_10%,transparent_75%)]" />
      <div className="bg-primary/15 absolute top-0 left-1/2 h-[26rem] w-[40rem] -translate-x-1/2 -translate-y-1/3 rounded-full blur-3xl" />
    </div>
  );
}

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
        "group bg-card/70 hover:border-primary/40 hover:shadow-primary/30 flex flex-col rounded-2xl border p-5 backdrop-blur transition-all hover:-translate-y-0.5 hover:shadow-[0_28px_60px_-32px]",
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
        <div className="min-w-0">
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
      <div className="min-w-0">
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
        <p className="line-clamp-3 text-lg leading-relaxed font-medium text-pretty">
          {quote.text}
        </p>
      </blockquote>
      <figcaption className="text-muted-foreground mt-3 ps-6 text-sm">
        — {quote.author} · {plural(stats.total, "ציטוט אחד", "ציטוטים")} בקיר
      </figcaption>
    </figure>
  );
}
