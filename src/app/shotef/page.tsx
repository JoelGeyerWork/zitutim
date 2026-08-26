import type { Metadata } from "next";

import { PageHeader, PageShell } from "@/components/page-shell";
import { ShotefRoulette } from "@/components/shotef-roulette";
import { getShotefRotation } from "@/lib/shotef";

// Whose week it is is read off the clock, so a build-time snapshot would be
// wrong the moment it shipped — the same reason `/meetups` is dynamic.
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "שוטף",
};

export default async function ShotefPage() {
  // Fixed here rather than in the client component, for the same reason the
  // meetup roulette takes `nowIso`: a `new Date()` on both sides of hydration
  // disagrees across a midnight or a week boundary, and the wheel would hydrate
  // onto a different person than it rendered.
  const now = new Date();

  // The data layer directly, no HTTP hop — like the meetup wheel and the feed.
  const initialRoster = await getShotefRotation();

  return (
    <PageShell>
      <PageHeader
        title="התורנות"
        description="שבוע לכל אחד. השוטף לוקח את הבאגים, את התקלות ואת כל מה שנופל באמצע."
      />
      <ShotefRoulette
        initialRoster={initialRoster}
        nowIso={now.toISOString()}
      />
    </PageShell>
  );
}
