import type { Metadata } from "next";

import { PageHeader, PageShell } from "@/components/page-shell";
import { ShotefReviews } from "@/components/shotef-reviews";
import { SHOTEF_REVIEWS, SHOTEF_ROSTER } from "@/lib/shotef";

export const metadata: Metadata = {
  title: "סיכומי שבוע",
};

// "Now" decides which weeks the picker offers, so it is read per request rather
// than frozen into a build.
export const dynamic = "force-dynamic";

export default function ShotefReviewsPage() {
  return (
    <PageShell>
      <PageHeader
        title="סיכומי שבוע"
        description="כל שבוע תורנות מקבל ציון וכמה שורות. הציון הוא של השבוע, לא של האדם."
      />
      <ShotefReviews
        initial={SHOTEF_REVIEWS}
        roster={SHOTEF_ROSTER}
        nowIso={new Date().toISOString()}
      />
    </PageShell>
  );
}
