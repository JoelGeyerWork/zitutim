import type { Metadata } from "next";

import { MeetupRoulette } from "@/components/meetup-roulette";
import { PageHeader, PageShell } from "@/components/page-shell";
import { ROSTER } from "@/lib/roster";

// "This week" is read off the clock, so a build-time snapshot would be wrong
// the moment it shipped — same reason the quote feed is dynamic.
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "ישבצ״ים",
};

export default function MeetupsPage() {
  // Fixing "now" here rather than in the client component keeps the first
  // client render identical to the server's — a `new Date()` on both sides
  // would disagree across a midnight or a week boundary.
  const now = new Date();

  return (
    <PageShell>
      <PageHeader
        title="התור"
        description="ישיבת צוות אחת בשבוע, והכיבוד מתגלגל בין כל חברי הצוות"
      />
      <MeetupRoulette initialRoster={ROSTER} nowIso={now.toISOString()} />
    </PageShell>
  );
}
