import type { Metadata } from "next";

import { CreateQuoteView } from "@/components/create-quote-view";

export const metadata: Metadata = {
  title: "ציטוט חדש · ציטוטים",
};

export default function CreatePage() {
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
