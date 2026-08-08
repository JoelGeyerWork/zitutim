import Link from "next/link";
import { PlusIcon } from "lucide-react";

import { QuoteFeed } from "@/components/quote-feed";
import { buttonVariants } from "@/components/ui/button";
import { plural } from "@/lib/format";
import { cn } from "@/lib/utils";
import { getStats, listQuotes } from "@/lib/quotes";

export const dynamic = "force-dynamic";

export default async function FeedPage() {
  const [page, stats] = await Promise.all([listQuotes(), getStats()]);

  return (
    <div className="mx-auto max-w-2xl px-4 py-6">
      <div className="mb-6 flex items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">קיר הציטוטים</h1>
          <p className="text-muted-foreground mt-1 text-sm">
            {stats.total === 0
              ? "כל מה שנאמר ולא כדאי לשכוח"
              : `${plural(stats.total, "ציטוט אחד", "ציטוטים")} מ־${plural(
                  stats.authors,
                  "אדם אחד",
                  "אנשים",
                )}`}
          </p>
        </div>

        <Link href="/create" className={cn(buttonVariants(), "gap-1.5")}>
          <PlusIcon className="size-4" />
          ציטוט חדש
        </Link>
      </div>

      {stats.topAuthor && stats.topAuthor.count > 1 ? (
        <p className="bg-accent text-accent-foreground mb-6 rounded-xl px-4 py-3 text-sm">
          <span className="font-semibold">{stats.topAuthor.author}</span> מוביל
          את הטבלה עם {stats.topAuthor.count} ציטוטים
        </p>
      ) : null}

      <QuoteFeed initial={page} />
    </div>
  );
}
