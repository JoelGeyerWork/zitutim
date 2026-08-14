import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { CreateQuoteView } from "@/components/create-quote-view";
import { getSession } from "@/lib/session";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "ציטוט חדש · ציטוטים",
};

export default async function CreatePage() {
  // UX only — the API's 401 is the actual enforcement. Redirect rather than
  // returning null, which wouldn't stop the route rendering anyway.
  const user = await getSession();
  if (!user) redirect("/login?next=/create");

  return (
    <div className="mx-auto max-w-2xl px-4 py-6">
      <header className="mb-6">
        <h1 className="text-2xl font-bold tracking-tight">ציטוט חדש</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          מי אמר, מה נאמר, ומתי. ההקשר הוא בונוס.
        </p>
      </header>

      <CreateQuoteView />
    </div>
  );
}
