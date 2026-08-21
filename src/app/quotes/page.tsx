import type { Metadata } from "next";

import { PageHeader, PageShell } from "@/components/page-shell";
import { QuoteFeed } from "@/components/quote-feed";
import { plural } from "@/lib/format";
import { getStats, listQuotes } from "@/lib/quotes";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "ציטוטים",
};

export default async function FeedPage() {
  const [page, stats] = await Promise.all([listQuotes(), getStats()]);

  return (
    <PageShell>
      {/* No search/new buttons here: both are tabs in the section bar above,
          and a second copy of a control one row down is just noise. */}
      <PageHeader
        title="קיר הציטוטים"
        description={
          stats.total === 0
            ? "כל מה שנאמר ולא כדאי לשכוח"
            : `${plural(stats.total, "ציטוט אחד", "ציטוטים")} מ־${plural(
                stats.authors,
                "אדם אחד",
                "אנשים",
              )}`
        }
      />

      {stats.topAuthor && stats.topAuthor.count > 1 ? (
        <p className="bg-accent text-accent-foreground mb-6 rounded-xl px-4 py-3 text-sm">
          <span className="font-semibold">{stats.topAuthor.author}</span> מוביל
          את הטבלה עם {stats.topAuthor.count} ציטוטים
        </p>
      ) : null}

      <QuoteFeed initial={page} />
    </PageShell>
  );
}
