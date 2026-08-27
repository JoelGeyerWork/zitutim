import type { Metadata } from "next";

import { HallOfFame } from "@/components/shotef-hall-of-fame";
import { PageHeader, PageShell } from "@/components/page-shell";
import { withoutDirectoryId } from "@/lib/roster";
import { getShotefRotation } from "@/lib/shotef";
import { getHallOfFame } from "@/lib/shotef-monitors";

export const metadata: Metadata = {
  title: "היכל התהילה",
};

// The wall grows, so it is read per request rather than frozen into a build.
export const dynamic = "force-dynamic";

export default async function HallOfFamePage() {
  // The data layers directly, no HTTP hop — like the feed and the reviews. The
  // rotation is here only for the add dialog, which offers the on-call team as
  // the names to put on a new certificate; who is on an *existing* plaque is
  // resolved from `users` in `getHallOfFame`, so a recipient since removed from
  // the rotation keeps their name on it.
  const [initial, roster] = await Promise.all([
    getHallOfFame(),
    getShotefRotation(),
  ]);

  return (
    <PageShell>
      <PageHeader
        title="היכל התהילה"
        description="מוניטורים שצעקו, ומה בסוף השתיק אותם. הפעם הבאה שהם יצעקו כבר לא תהיה מאפס."
      />
      <HallOfFame initial={initial} roster={withoutDirectoryId(roster)} />
    </PageShell>
  );
}
