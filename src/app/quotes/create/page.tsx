import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { CreateQuoteView } from "@/components/create-quote-view";
import { PageHeader, PageShell } from "@/components/page-shell";
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
  // be named: the form searches the directory for anyone else.
  //
  // `directoryId` is kept rather than stripped, the one thing `RotationEditor`
  // also keeps it for: recognising a search result as somebody already on the
  // row, instead of offering their name twice. `withoutDirectoryId` guards
  // pages that render *anonymously*, and this one redirects above.
  const roster = await getRotation();

  return (
    <PageShell>
      <PageHeader
        title="ציטוט חדש"
        description="מי אמר, מה נאמר, ומתי. ההקשר הוא בונוס."
      />
      <CreateQuoteView roster={roster} />
    </PageShell>
  );
}
