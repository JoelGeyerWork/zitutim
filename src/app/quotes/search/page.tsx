import type { Metadata } from "next";

import { PageHeader, PageShell } from "@/components/page-shell";
import { QuoteSearch } from "@/components/quote-search";

export const metadata: Metadata = {
  title: "חיפוש ציטוטים",
};

export default function SearchPage() {
  return (
    <PageShell>
      <PageHeader title="חיפוש" description="מי אמר את זה, ומתי בדיוק?" />
      <QuoteSearch />
    </PageShell>
  );
}
