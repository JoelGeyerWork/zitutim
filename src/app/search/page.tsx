import type { Metadata } from "next";

import { QuoteSearch } from "@/components/quote-search";

export const metadata: Metadata = {
  title: "חיפוש · ציטוטים",
};

export default function SearchPage() {
  return (
    <div className="mx-auto max-w-2xl px-4 py-6">
      <header className="mb-6">
        <h1 className="text-2xl font-bold tracking-tight">חיפוש</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          מי אמר את זה, ומתי בדיוק?
        </p>
      </header>

      <QuoteSearch />
    </div>
  );
}
