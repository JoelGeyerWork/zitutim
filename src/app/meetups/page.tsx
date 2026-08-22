import type { Metadata } from "next";

import { MeetupRoulette } from "@/components/meetup-roulette";
import { PageHeader, PageShell } from "@/components/page-shell";
import { getRotation } from "@/lib/rotation";

// "This week" is read off the clock and the rotation off the database, so a
// build-time snapshot would be wrong the moment it shipped — same reason the
// quote feed is dynamic, and why `next build` needs no MONGODB_URI.
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "ישבצ״ים",
};

export default async function MeetupsPage() {
  // Fixing "now" here rather than in the client component keeps the first
  // client render identical to the server's — a `new Date()` on both sides
  // would disagree across a midnight or a week boundary.
  const now = new Date();

  // Read the data layer directly, no HTTP hop, like the quote feed and themes.
  const initialRoster = await getRotation();

  return (
    <PageShell>
      <PageHeader
        title="התור"
        description="ישיבת צוות אחת בשבוע, והכיבוד מתגלגל בין כל חברי הצוות"
      />
      <MeetupRoulette
        initialRoster={initialRoster}
        nowIso={now.toISOString()}
      />
    </PageShell>
  );
}
