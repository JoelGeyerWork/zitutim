import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { CreateQuoteView } from "@/components/create-quote-view";
import { PageHeader, PageShell } from "@/components/page-shell";
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

  return (
    <PageShell>
      <PageHeader
        title="ציטוט חדש"
        description="מי אמר, מה נאמר, ומתי. ההקשר הוא בונוס."
      />
      <CreateQuoteView />
    </PageShell>
  );
}
