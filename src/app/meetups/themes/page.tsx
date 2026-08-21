import type { Metadata } from "next";

import { PageHeader, PageShell } from "@/components/page-shell";
import { ThemesView } from "@/components/themes-view";
import { lastMeetup, memberOn } from "@/lib/team";
import {
  getStandings,
  getThemeRoster,
  getThemeStats,
  listThemes,
} from "@/lib/themes";

// Reads live data and seeds the add form's date, so it has to run per request —
// the same reason the quote feed is dynamic. It is also why `next build` needs
// no MONGODB_URI: nothing here runs at build time.
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "נושאי הכיבוד",
};

export default async function ThemesPage() {
  // Fixed here rather than in the client component, for the same reason the
  // roulette takes `nowIso` — the two sides must agree on what day it is.
  const now = new Date();

  // Read the data layer directly, with no HTTP hop. Standings and stats are
  // computed server-side across every theme, never derived from a page.
  const [initial, standings, stats, members] = await Promise.all([
    listThemes(),
    getStandings(),
    getThemeStats(),
    getThemeRoster(),
  ]);

  // The rotation names a `team.ts` member; map it to the real `users._id` the
  // picker posts. Falls back to the first member if that person has no row yet.
  const rotationName = memberOn(lastMeetup(now)).name;
  const defaultBroughtById =
    members.find((member) => member.name === rotationName)?.id ??
    members[0]?.id ??
    "";

  return (
    <PageShell>
      <PageHeader
        title="נושאי הכיבוד"
        description="לכל כיבוד יש נושא נסתר. השאר מנחשים אותו מהשולחן."
      />
      <ThemesView
        initial={initial}
        standings={standings}
        stats={stats}
        members={members}
        nowIso={now.toISOString()}
        defaultBroughtById={defaultBroughtById}
      />
    </PageShell>
  );
}
