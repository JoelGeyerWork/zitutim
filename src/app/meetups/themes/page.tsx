import type { Metadata } from "next";

import { PageHeader, PageShell } from "@/components/page-shell";
import { ThemesView } from "@/components/themes-view";
import { lastMeetup, rotationIndex } from "@/lib/team";
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

  // `members` is the rotation in stored order, so whose turn it was is a direct
  // index — no name round-trip. Falls back to the first member, then to empty on
  // an unseeded database.
  const defaultBroughtById =
    members[rotationIndex(lastMeetup(now), members.length)]?.id ??
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
