import type { Metadata } from "next";

import { PageHeader, PageShell } from "@/components/page-shell";
import { ShotefReviews } from "@/components/shotef-reviews";
import { SHOTEF_REVIEWS } from "@/lib/shotef";

export const metadata: Metadata = {
  title: "סיכומי שבוע",
};

export default function ShotefReviewsPage() {
  return (
    <PageShell>
      <PageHeader
        title="סיכומי שבוע"
        description="כל שבוע תורנות מקבל ציון וכמה שורות. הציון הוא של השבוע, לא של האדם."
      />
      <ShotefReviews reviews={SHOTEF_REVIEWS} />
    </PageShell>
  );
}
