"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Loader2Icon, SearchIcon, SearchXIcon, XIcon } from "lucide-react";
import { toast } from "sonner";

import { QuoteCard } from "@/components/quote-card";
import { plural } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import {
  PAGE_SIZE,
  SORT_LABELS,
  SORT_OPTIONS,
  type QuotePage,
  type SortOption,
} from "@/lib/quote-schema";

const DEBOUNCE_MS = 250;

export function QuoteSearch() {
  const [term, setTerm] = useState("");
  const [sort, setSort] = useState<SortOption>("added");
  const [page, setPage] = useState<QuotePage | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);

  /** The term the currently displayed results belong to (for highlighting). */
  const [appliedTerm, setAppliedTerm] = useState("");

  // A monotonic id so a slow early request can't overwrite a newer response.
  const requestId = useRef(0);

  const run = useCallback(
    async (search: string, sortBy: SortOption) => {
      const id = ++requestId.current;
      setLoading(true);
      try {
        const params = new URLSearchParams({
          sort: sortBy,
          limit: String(PAGE_SIZE),
        });
        if (search.trim()) params.set("q", search.trim());

        const response = await fetch(`/api/quotes?${params}`);
        if (!response.ok) throw new Error(String(response.status));
        const result: QuotePage = await response.json();

        if (id !== requestId.current) return;
        setPage(result);
        setAppliedTerm(search.trim());
      } catch {
        if (id !== requestId.current) return;
        toast.error("החיפוש נכשל");
        setPage({ quotes: [], total: 0, hasMore: false });
      } finally {
        if (id === requestId.current) setLoading(false);
      }
    },
    [],
  );

  // Debounce the text, but react to a sort change immediately.
  useEffect(() => {
    const timer = setTimeout(() => run(term, sort), term ? DEBOUNCE_MS : 0);
    return () => clearTimeout(timer);
  }, [term, sort, run]);

  async function loadMore() {
    if (!page?.hasMore || loadingMore) return;
    setLoadingMore(true);
    try {
      const params = new URLSearchParams({
        sort,
        skip: String(page.quotes.length),
        limit: String(PAGE_SIZE),
      });
      if (appliedTerm) params.set("q", appliedTerm);

      const response = await fetch(`/api/quotes?${params}`);
      if (!response.ok) throw new Error(String(response.status));
      const next: QuotePage = await response.json();

      setPage((current) => {
        if (!current) return next;
        const seen = new Set(current.quotes.map((quote) => quote.id));
        return {
          ...next,
          quotes: [
            ...current.quotes,
            ...next.quotes.filter((quote) => !seen.has(quote.id)),
          ],
        };
      });
    } catch {
      toast.error("לא הצלחנו לטעון עוד תוצאות");
    } finally {
      setLoadingMore(false);
    }
  }

  const summary = useMemo(() => {
    if (!page) return null;
    if (!appliedTerm) {
      return `${plural(page.total, "ציטוט אחד", "ציטוטים")} בקיר`;
    }
    if (page.total === 0) return null;
    return `${plural(page.total, "תוצאה אחת", "תוצאות")} עבור ״${appliedTerm}״`;
  }, [page, appliedTerm]);

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-3 sm:flex-row">
        <div className="relative flex-1">
          <SearchIcon className="text-muted-foreground pointer-events-none absolute inset-y-0 start-3 my-auto size-4" />
          <Input
            value={term}
            onChange={(event) => setTerm(event.target.value)}
            placeholder="חיפוש בציטוט, בשם או בהקשר…"
            aria-label="חיפוש ציטוטים"
            autoFocus
            className="h-11 ps-9 pe-9 text-base"
          />
          {term ? (
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={() => setTerm("")}
              aria-label="ניקוי החיפוש"
              className="text-muted-foreground absolute inset-y-0 end-1.5 my-auto"
            >
              <XIcon className="size-4" />
            </Button>
          ) : null}
        </div>

        <Select
          value={sort}
          onValueChange={(value) => setSort(value as SortOption)}
        >
          <SelectTrigger className="h-11 w-full sm:w-48" aria-label="מיון">
            {/* Base UI renders the raw value unless told how to label it. */}
            <SelectValue>
              {(value: SortOption) => SORT_LABELS[value]}
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            {SORT_OPTIONS.map((option) => (
              <SelectItem key={option} value={option}>
                {SORT_LABELS[option]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {summary ? (
        <p className="text-muted-foreground text-sm">{summary}</p>
      ) : null}

      {loading && !page ? (
        <ResultsSkeleton />
      ) : page && page.quotes.length === 0 ? (
        <NoResults term={appliedTerm} />
      ) : (
        <div className="space-y-4" aria-busy={loading}>
          {page?.quotes.map((quote) => (
            <QuoteCard
              key={quote.id}
              quote={quote}
              highlight={appliedTerm}
              onChanged={() => run(appliedTerm, sort)}
            />
          ))}

          {page?.hasMore ? (
            <div className="pt-2 text-center">
              <Button
                variant="outline"
                onClick={loadMore}
                disabled={loadingMore}
                className="gap-2"
              >
                {loadingMore ? (
                  <Loader2Icon className="size-4 animate-spin" />
                ) : null}
                עוד תוצאות
              </Button>
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
}

function ResultsSkeleton() {
  return (
    <div className="space-y-4">
      {[0, 1, 2].map((index) => (
        <div key={index} className="bg-card space-y-3 rounded-2xl border p-5">
          <div className="flex items-center gap-3">
            <Skeleton className="size-11 rounded-full" />
            <div className="flex-1 space-y-2">
              <Skeleton className="h-4 w-32" />
              <Skeleton className="h-3 w-48" />
            </div>
          </div>
          <Skeleton className="h-5 w-full" />
          <Skeleton className="h-5 w-3/4" />
        </div>
      ))}
    </div>
  );
}

function NoResults({ term }: { term: string }) {
  return (
    <div className="bg-card rounded-2xl border border-dashed px-6 py-14 text-center">
      <SearchXIcon className="text-muted-foreground/50 mx-auto size-8" />
      <h2 className="mt-4 font-semibold">
        {term ? `אין תוצאות ל״${term}״` : "אין עדיין ציטוטים"}
      </h2>
      <p className="text-muted-foreground mt-1.5 text-sm">
        {term ? "אולי כדאי לנסות מילה אחרת או רק את השם." : "הקיר עוד ריק."}
      </p>
    </div>
  );
}
