"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  LightbulbIcon,
  Loader2Icon,
  SearchIcon,
  SearchXIcon,
  XIcon,
} from "lucide-react";
import { toast } from "sonner";

import { PersonAvatar } from "@/components/person-avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { formatMeetupDate, plural } from "@/lib/format";
import { THEME_PAGE_SIZE, type Theme, type ThemePage } from "@/lib/theme-schema";

const DEBOUNCE_MS = 250;

/**
 * The searchable two-column history. Lives apart from the leaderboard and the
 * add dialog so search state can't leak into either — the same split the quote
 * wall keeps between `QuoteFeed` and `QuoteSearch`.
 */
export function ThemeHistory({ initial }: { initial: ThemePage }) {
  const [themes, setThemes] = useState(initial.themes);
  const [hasMore, setHasMore] = useState(initial.hasMore);
  const [loading, setLoading] = useState(false);
  const [term, setTerm] = useState("");
  const [appliedTerm, setAppliedTerm] = useState("");
  const [matches, setMatches] = useState<ThemePage | null>(null);
  const [searching, setSearching] = useState(false);
  // A monotonic id so a slow early request can't overwrite a newer response.
  const requestId = useRef(0);

  // router.refresh() re-runs the server component and hands us a new `initial`.
  // Adjusting during render (rather than in an effect) drops the extra paint —
  // and `react-hooks/set-state-in-effect` is an error in this config anyway.
  const [seed, setSeed] = useState(initial);
  if (seed !== initial) {
    setSeed(initial);
    setThemes(initial.themes);
    setHasMore(initial.hasMore);
  }

  // Clearing is local, same as re-seeding: do it during render so we don't
  // trip `react-hooks/set-state-in-effect`. In-flight searches are dropped in
  // the input handlers by bumping `requestId` before `term` goes empty.
  if (!term.trim() && (appliedTerm || matches || searching)) {
    setAppliedTerm("");
    setMatches(null);
    setSearching(false);
  }

  const runSearch = useCallback(async (search: string) => {
    const id = ++requestId.current;
    // A new query invalidates an in-flight load-more: that page belongs to
    // the previous term, and its `loading` lock would swallow a click on
    // the results that are about to land.
    setLoading(false);
    setSearching(true);
    try {
      const params = new URLSearchParams({
        q: search,
        limit: String(THEME_PAGE_SIZE),
      });
      const response = await fetch(`/api/themes?${params}`);
      if (!response.ok) throw new Error(String(response.status));
      const page: ThemePage = await response.json();
      if (id !== requestId.current) return;
      setMatches(page);
      setAppliedTerm(search);
    } catch {
      if (id !== requestId.current) return;
      toast.error("החיפוש נכשל");
      setMatches({ themes: [], total: 0, hasMore: false });
      setAppliedTerm(search);
    } finally {
      if (id === requestId.current) setSearching(false);
    }
  }, []);

  // Debounce the text. An empty term is handled above — the first page already
  // arrived with the SSR payload, and fetching it again would flash the list.
  // `seed` is a dep so a refresh while a term is applied re-runs the query.
  useEffect(() => {
    const trimmed = term.trim();
    if (!trimmed) return;
    const timer = setTimeout(() => runSearch(trimmed), DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [term, seed, runSearch]);

  const displayed = appliedTerm ? (matches?.themes ?? []) : themes;
  const displayedHasMore = appliedTerm
    ? (matches?.hasMore ?? false)
    : hasMore;

  const loadMore = useCallback(async () => {
    if (loading || !displayedHasMore) return;
    // Capture the generation of the query this page belongs to. `runSearch`
    // (and clear) bump `requestId`, so a slow page for "עג" cannot merge
    // into the "עגול" list that replaced it while we were in flight.
    const id = requestId.current;
    const forTerm = appliedTerm;
    setLoading(true);
    try {
      const params = new URLSearchParams({
        skip: String(displayed.length),
        limit: String(THEME_PAGE_SIZE),
      });
      if (forTerm) params.set("q", forTerm);

      const response = await fetch(`/api/themes?${params}`);
      if (!response.ok) throw new Error(String(response.status));

      const page: ThemePage = await response.json();
      if (id !== requestId.current) return;

      const merge = (current: Theme[]) => {
        const seen = new Set(current.map((theme) => theme.id));
        return [...current, ...page.themes.filter((t) => !seen.has(t.id))];
      };

      if (forTerm) {
        setMatches((current) =>
          current ? { ...page, themes: merge(current.themes) } : page,
        );
      } else {
        setThemes(merge);
        setHasMore(page.hasMore);
      }
    } catch {
      if (id !== requestId.current) return;
      toast.error("לא הצלחנו לטעון עוד נושאים");
      if (forTerm) {
        setMatches((current) =>
          current ? { ...current, hasMore: false } : current,
        );
      } else {
        setHasMore(false);
      }
    } finally {
      if (id === requestId.current) setLoading(false);
    }
  }, [appliedTerm, displayed.length, displayedHasMore, loading]);

  return (
    <section className="space-y-3">
      <h2 className="text-muted-foreground text-xs font-semibold">
        ההיסטוריה
      </h2>

      <div className="relative">
        <SearchIcon className="text-muted-foreground pointer-events-none absolute inset-y-0 start-3 my-auto size-4" />
        <Input
          value={term}
          onChange={(event) => {
            const value = event.target.value;
            if (!value.trim()) {
              requestId.current += 1;
              setLoading(false);
            }
            setTerm(value);
          }}
          placeholder="חיפוש בנושא, בכיבוד או בשם…"
          aria-label="חיפוש נושאים"
          className="h-11 ps-9 pe-9 text-base"
        />
        {term ? (
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={() => {
              requestId.current += 1;
              setLoading(false);
              setTerm("");
            }}
            aria-label="ניקוי החיפוש"
            className="text-muted-foreground absolute inset-y-0 end-1.5 my-auto"
          >
            <XIcon className="size-4" />
          </Button>
        ) : null}
      </div>

      {appliedTerm && matches && matches.total > 0 ? (
        <p className="text-muted-foreground text-sm">
          {`${plural(matches.total, "תוצאה אחת", "תוצאות")} עבור ״${appliedTerm}״`}
        </p>
      ) : null}

      {appliedTerm && displayed.length === 0 && !searching ? (
        <NoResults term={appliedTerm} />
      ) : (
        <div
          className="grid grid-cols-1 gap-3 sm:grid-cols-2"
          aria-busy={searching}
        >
          {displayed.map((theme) => (
            <ThemeCard key={theme.id} theme={theme} highlight={appliedTerm} />
          ))}
        </div>
      )}

      {displayedHasMore ? (
        <div className="py-2 text-center">
          {loading ? (
            <Loader2Icon className="text-muted-foreground mx-auto size-5 animate-spin" />
          ) : (
            <Button variant="outline" onClick={loadMore}>
              עוד נושאים
            </Button>
          )}
        </div>
      ) : null}
    </section>
  );
}

function ThemeCard({
  theme,
  highlight,
}: {
  theme: Theme;
  highlight?: string;
}) {
  return (
    <article className="bg-card flex flex-col rounded-2xl border p-5 shadow-sm">
      <div className="flex-1">
        <header className="flex items-center gap-3">
          <PersonAvatar name={theme.broughtBy} className="size-9 text-sm" />
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium">
              <Highlighted text={theme.broughtBy} term={highlight} />
            </p>
            <p className="text-muted-foreground truncate text-xs">
              {formatMeetupDate(theme.date)}
            </p>
          </div>
        </header>

        <p className="mt-3 flex items-start gap-2 text-lg leading-snug font-semibold text-balance">
          <LightbulbIcon className="text-primary mt-1 size-4 shrink-0" />
          <Highlighted className="min-w-0" text={theme.theme} term={highlight} />
        </p>

        {theme.snacks.length > 0 ? (
          <ul className="mt-3 flex flex-wrap gap-1.5">
            {theme.snacks.map((snack) => (
              <li key={snack}>
                <Badge variant="outline" className="font-normal">
                  <Highlighted text={snack} term={highlight} />
                </Badge>
              </li>
            ))}
          </ul>
        ) : null}
      </div>

      <footer className="mt-4 border-t pt-3 text-sm">
        {theme.guessedBy ? (
          <span className="flex items-center gap-2">
            <PersonAvatar name={theme.guessedBy} className="size-6 text-xs" />
            {/* Passive "was guessed by" agrees with the theme, never the
                guesser — so a guesser who has left the rotation (and whose
                gender we no longer hold) still reads correctly. */}
            <span>
              נוחש על ידי{" "}
              <span className="font-medium">
                <Highlighted text={theme.guessedBy} term={highlight} />
              </span>
            </span>
          </span>
        ) : (
          <span className="text-muted-foreground">אף אחד לא ניחש</span>
        )}
      </footer>
    </article>
  );
}

/** Wraps every case-insensitive occurrence of `term` in a <mark>. */
function Highlighted({
  text,
  term,
  className,
}: {
  text: string;
  term?: string;
  className?: string;
}) {
  const needle = term?.trim();
  if (!needle) {
    return className ? <span className={className}>{text}</span> : <>{text}</>;
  }

  const pattern = new RegExp(
    `(${needle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")})`,
    "gi",
  );

  // A single element, not a fragment: this sits inside `flex … gap-*`
  // (the title, the snack chips). split() yields empty strings around a
  // match, and as sibling flex items those would insert the gap into the word.
  return (
    <span className={className}>
      {text.split(pattern).map((part, index) =>
        index % 2 === 1 ? (
          <mark
            key={index}
            className="bg-primary/20 text-foreground rounded px-0.5"
          >
            {part}
          </mark>
        ) : (
          <span key={index}>{part}</span>
        ),
      )}
    </span>
  );
}

function NoResults({ term }: { term: string }) {
  return (
    <div className="bg-card rounded-2xl border border-dashed px-6 py-14 text-center">
      <SearchXIcon className="text-muted-foreground/50 mx-auto size-8" />
      <h3 className="mt-4 font-semibold">אין תוצאות ל״{term}״</h3>
      <p className="text-muted-foreground mt-1.5 text-sm">
        אולי כדאי לנסות מילה אחרת, או רק את השם.
      </p>
    </div>
  );
}
