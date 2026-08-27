import type { Metadata } from "next";

import { PageHeader, PageShell } from "@/components/page-shell";
import { ShotefReviews } from "@/components/shotef-reviews";
import { getShotefRotation } from "@/lib/shotef";
import { getShotefReviews } from "@/lib/shotef-reviews";

export const metadata: Metadata = {
  title: "סיכומי שבוע",
};

// "Now" decides which weeks the picker offers, so it is read per request rather
// than frozen into a build.
export const dynamic = "force-dynamic";

export default async function ShotefReviewsPage() {
  // The data layers directly, no HTTP hop — like the feed and the wheel. The
  // rotation is here only for the add dialog: it answers who to offer as this
  // week's shotef. Whose week a *past* summary was is resolved from `users` in
  // `getShotefReviews`, so a member since removed keeps their name on it.
  const [initial, roster] = await Promise.all([
    getShotefReviews(),
    getShotefRotation(),
  ]);

  return (
    <PageShell>
      <PageHeader
        title="סיכומי שבוע"
        description="כל שבוע תורנות מקבל ציון וכמה שורות. הציון הוא של השבוע, לא של האדם."
      />
      <ShotefReviews
        initial={initial}
        roster={roster}
        nowIso={new Date().toISOString()}
      />
    </PageShell>
  );
}
