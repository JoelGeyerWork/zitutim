"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Loader2Icon, PlusIcon } from "lucide-react";
import { toast } from "sonner";

import { QuoteCard } from "@/components/quote-card";
import { Button, buttonVariants } from "@/components/ui/button";
import { plural } from "@/lib/format";
import { cn } from "@/lib/utils";
import { PAGE_SIZE, type QuotePage } from "@/lib/quote-schema";

export function QuoteFeed({ initial }: { initial: QuotePage }) {
  const [quotes, setQuotes] = useState(initial.quotes);
  const [hasMore, setHasMore] = useState(initial.hasMore);
  const [loading, setLoading] = useState(false);
  const sentinel = useRef<HTMLDivElement>(null);

  // router.refresh() re-runs the server component and hands us a new `initial`.
  // Adjusting during render (rather than in an effect) drops the extra paint.
  const [seed, setSeed] = useState(initial);
  if (seed !== initial) {
    setSeed(initial);
    setQuotes(initial.quotes);
    setHasMore(initial.hasMore);
  }

  const loadMore = useCallback(async () => {
    if (loading || !hasMore) return;
    setLoading(true);
    try {
      const response = await fetch(
        `/api/quotes?skip=${quotes.length}&limit=${PAGE_SIZE}`,
      );
      if (!response.ok) throw new Error(String(response.status));

      const page: QuotePage = await response.json();
      setQuotes((current) => {
        const seen = new Set(current.map((quote) => quote.id));
        return [...current, ...page.quotes.filter((q) => !seen.has(q.id))];
      });
      setHasMore(page.hasMore);
    } catch {
      toast.error("לא הצלחנו לטעון עוד ציטוטים");
      setHasMore(false);
    } finally {
      setLoading(false);
    }
  }, [hasMore, loading, quotes.length]);

  // Infinite scroll: fetch the next page when the sentinel enters the viewport.
  useEffect(() => {
    const node = sentinel.current;
    if (!node || !hasMore) return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) loadMore();
      },
      { rootMargin: "400px" },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [hasMore, loadMore]);

  /** After an edit or delete, re-fetch everything we've scrolled through. */
  const refresh = useCallback(async () => {
    const size = Math.max(quotes.length, PAGE_SIZE);
    try {
      const response = await fetch(`/api/quotes?skip=0&limit=${size}`);
      if (!response.ok) return;
      const page: QuotePage = await response.json();
      setQuotes(page.quotes);
      setHasMore(page.hasMore);
    } catch {
      /* the toast from the mutation itself is enough */
    }
  }, [quotes.length]);

  if (quotes.length === 0) {
    return <EmptyFeed />;
  }

  return (
    <div className="space-y-4">
      {quotes.map((quote) => (
        <QuoteCard key={quote.id} quote={quote} onChanged={refresh} />
      ))}

      <div ref={sentinel} className="py-4 text-center">
        {loading ? (
          <Loader2Icon className="text-muted-foreground mx-auto size-5 animate-spin" />
        ) : hasMore ? (
          <Button variant="outline" onClick={loadMore}>
            עוד ציטוטים
          </Button>
        ) : (
          <p className="text-muted-foreground text-sm">
            הגעת לתחילת הקיר ✦ {plural(quotes.length, "ציטוט אחד", "ציטוטים")}
          </p>
        )}
      </div>
    </div>
  );
}

function EmptyFeed() {
  return (
    <div className="bg-card rounded-2xl border border-dashed px-6 py-16 text-center">
      <span
        aria-hidden
        className="text-primary/25 quote-mark block text-7xl font-bold"
      >
        ״
      </span>
      <h2 className="mt-2 text-xl font-bold">הקיר עוד ריק</h2>
      <p className="text-muted-foreground mx-auto mt-2 max-w-sm text-sm text-balance">
        מישהו בטוח אמר משהו שראוי להישמר. תהיו הראשונים לתעד.
      </p>
      {/* Styled as a button but left as a real link, so it keeps link
          semantics for assistive tech and open-in-new-tab. */}
      <Link
        href="/quotes/create"
        className={cn(buttonVariants({ size: "lg" }), "mt-6 gap-2")}
      >
        <PlusIcon className="size-4" />
        הוספת הציטוט הראשון
      </Link>
    </div>
  );
}
