import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { CreateQuoteView } from "@/components/create-quote-view";
import { PageHeader, PageShell } from "@/components/page-shell";
import { withoutDirectoryId } from "@/lib/roster";
import { getRotation } from "@/lib/rotation";
import { getSession } from "@/lib/session";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "ציטוט חדש",
};

export default async function CreatePage() {
  // UX only — the API's 401 is the actual enforcement. Redirect rather than
  // returning null, which wouldn't stop the route rendering anyway.
  const user = await getSession();
  if (!user) redirect("/login?next=/quotes/create");

  // The rotation is the team, and the team is who gets quoted — so it fills the
  // "מי אמר?" picker without a directory round trip. Not the limit of who may
  // be named: the form searches the directory for anyone else. `directoryId` is
  // stripped for the same reason the שוטף pages strip it — nothing here needs
  // an objectGUID, and a page should not ship one it does not use.
  const roster = await getRotation();

  return (
    <PageShell>
      <PageHeader
        title="ציטוט חדש"
        description="מי אמר, מה נאמר, ומתי. ההקשר הוא בונוס."
      />
      <CreateQuoteView roster={withoutDirectoryId(roster)} />
    </PageShell>
  );
}
