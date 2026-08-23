import type { Metadata } from "next";

import { HallOfFame } from "@/components/shotef-hall-of-fame";
import { PageHeader, PageShell } from "@/components/page-shell";
import { HALL_OF_FAME } from "@/lib/shotef";

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
      <HallOfFame monitors={HALL_OF_FAME} />
    </PageShell>
  );
}
