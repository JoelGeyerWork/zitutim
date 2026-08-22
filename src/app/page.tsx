import Link from "next/link";
import { ArrowLeftIcon } from "lucide-react";

import { PageHeader, PageShell } from "@/components/page-shell";
import { PersonAvatar } from "@/components/person-avatar";
import { Badge } from "@/components/ui/badge";
import { formatMeetupDate, plural } from "@/lib/format";
import { HUB, SECTIONS, type Section } from "@/lib/navigation";
import { type RosterMember } from "@/lib/roster";
import { getRotation } from "@/lib/rotation";
import { conjugate, currentMeetup, daysUntil, MEETUP, rotationIndex } from "@/lib/team";
import { getSession } from "@/lib/session";
import { getStats, listQuotes } from "@/lib/quotes";
import { cn } from "@/lib/utils";

export const dynamic = "force-dynamic";

export default async function HubPage() {
  const now = new Date();

  const [user, stats, latest, roster] = await Promise.all([
    getSession(),
    getStats(),
    listQuotes({ limit: 1 }),
    getRotation(),
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

  /**
   * What each section shows on its card. A section with nothing registered
   * still gets a card — its description and a way in — so adding one to
   * `SECTIONS` is enough to make it appear here, and a teaser can follow later.
   */
  const teasers: Record<string, Teaser> = {
    "/meetups": thisWeek
      ? {
          // The meetup leads the hub: it is the one thing here that expires.
          className: "bg-accent text-accent-foreground border-transparent",
          content: <MeetupTeaser member={thisWeek.member} date={thisWeek.date} now={now} />,
        }
      : {},
    "/quotes": { content: <QuoteTeaser stats={stats} quote={latest.quotes[0]} /> },
  };

  return (
    <PageShell>
      {/* Not the app's name — the wordmark two lines up already says that. */}
      <PageHeader
        title={user ? `היי, ${user.name.split(" ")[0]}` : "היי, צוות"}
        description={HUB.description}
      />

      <div className="space-y-4">
        {SECTIONS.map((section) => (
          <SectionCard
            key={section.href}
            section={section}
            className={teasers[section.href]?.className}
          >
            {teasers[section.href]?.content}
          </SectionCard>
        ))}
      </div>
    </PageShell>
  );
}

// `content` is optional: an empty rotation registers a `/meetups` teaser with
// neither field, so the card falls back to the section description like any
// section with nothing registered.
type Teaser = { className?: string; content?: React.ReactNode };

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
        "group bg-card block rounded-2xl border p-5 shadow-sm transition-shadow hover:shadow-md",
        className,
      )}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Badge variant={children ? "default" : "outline"} className="gap-1">
          <section.icon className="size-3" />
          {section.label}
        </Badge>
      </div>

      {children ?? (
        <p className="text-muted-foreground mt-3 text-sm">
          {section.description}
        </p>
      )}

      <span className="mt-3 flex items-center gap-1 text-sm font-medium">
        {section.label}
        {/* Deliberately not flipped: in RTL, "onward" points left. */}
        <ArrowLeftIcon className="size-3.5 transition-transform group-hover:-translate-x-0.5" />
      </span>
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
      <div className="mt-3 flex items-center gap-3">
        <PersonAvatar name={member.name} className="size-12 text-lg" />
        <div className="min-w-0">
          <p className="truncate font-semibold">{member.name}</p>
          <p className="text-sm opacity-80">
            {conjugate(member, "מביא", "מביאה")} את הכיבוד ·{" "}
            {daysUntil(date, now)}
          </p>
        </div>
      </div>

      <p className="mt-3 border-t border-current/10 pt-3 text-sm opacity-80">
        {formatMeetupDate(date)}, {MEETUP.time} · {MEETUP.place}
      </p>
    </>
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
      <p className="text-muted-foreground mt-3 text-sm">
        מישהו בטוח אמר משהו שראוי להישמר. תהיו הראשונים לתעד.
      </p>
    );
  }

  return (
    <>
      <blockquote className="mt-3 line-clamp-3 leading-relaxed font-medium text-balance">
        ״{quote.text}״
      </blockquote>
      <p className="text-muted-foreground mt-2 text-sm">
        — {quote.author} · {plural(stats.total, "ציטוט אחד", "ציטוטים")} בקיר
      </p>
    </>
  );
}
