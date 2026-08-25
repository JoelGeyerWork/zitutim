import type { Metadata } from "next";

import { HallOfFame } from "@/components/shotef-hall-of-fame";
import { PageHeader, PageShell } from "@/components/page-shell";
import { HALL_OF_FAME, SHOTEF_ROSTER } from "@/lib/shotef";

export const metadata: Metadata = {
  title: "היכל התהילה",
};

export default function HallOfFamePage() {
  return (
    <PageShell>
      <PageHeader
        title="היכל התהילה"
        description="מוניטורים שצעקו, ומה בסוף השתיק אותם. הפעם הבאה שהם יצעקו כבר לא תהיה מאפס."
      />
      <HallOfFame initial={HALL_OF_FAME} roster={SHOTEF_ROSTER} />
    </PageShell>
  );
}
