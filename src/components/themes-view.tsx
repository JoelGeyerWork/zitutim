"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  CrownIcon,
  LightbulbIcon,
  Loader2Icon,
  PlusIcon,
  SearchIcon,
  SearchXIcon,
  XIcon,
} from "lucide-react";
import { toast } from "sonner";

import { PersonAvatar } from "@/components/person-avatar";
import { useSession } from "@/components/session-provider";
import { ThemeFormDialog } from "@/components/theme-form-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { formatMeetupDate, plural } from "@/lib/format";
import {
  THEME_PAGE_SIZE,
  placeOf,
  type Standing,
  type Theme,
  type ThemeMember,
  type ThemePage,
} from "@/lib/theme-schema";
import { cn } from "@/lib/utils";

const DEBOUNCE_MS = 250;

export function ThemesView({
  initial,
  standings,
  stats,
  members,
  nowIso,
  defaultBroughtById,
}: {
  initial: ThemePage;
  /** Computed server-side across every theme — never derived from the page. */
  standings: Standing[];
  stats: { total: number; solved: number };
  members: ThemeMember[];
  nowIso: string;
  defaultBroughtById: string;
}) {
  const [themes, setThemes] = useState(initial.themes);
  const [hasMore, setHasMore] = useState(initial.hasMore);
  const [loading, setLoading] = useState(false);
  const [adding, setAdding] = useState(false);
  const [term, setTerm] = useState("");
  const [appliedTerm, setAppliedTerm] = useState("");
  const [matches, setMatches] = useState<ThemePage | null>(null);
  const [searching, setSearching] = useState(false);
  const router = useRouter();
  const user = useSession();
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
    setLoading(true);
    try {
      const params = new URLSearchParams({
        skip: String(displayed.length),
        limit: String(THEME_PAGE_SIZE),
      });
      if (appliedTerm) params.set("q", appliedTerm);

      const response = await fetch(`/api/themes?${params}`);
      if (!response.ok) throw new Error(String(response.status));

      const page: ThemePage = await response.json();
      const merge = (current: Theme[]) => {
        const seen = new Set(current.map((theme) => theme.id));
        return [...current, ...page.themes.filter((t) => !seen.has(t.id))];
      };

      if (appliedTerm) {
        setMatches((current) =>
          current
            ? { ...page, themes: merge(current.themes) }
            : page,
        );
      } else {
        setThemes(merge);
        setHasMore(page.hasMore);
      }
    } catch {
      toast.error("לא הצלחנו לטעון עוד נושאים");
      if (appliedTerm) {
        setMatches((current) =>
          current ? { ...current, hasMore: false } : current,
        );
      } else {
        setHasMore(false);
      }
    } finally {
      setLoading(false);
    }
  }, [appliedTerm, displayed.length, displayedHasMore, loading]);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-muted-foreground text-sm">
          {plural(stats.total, "נושא אחד", "נושאים")} ·{" "}
          {plural(stats.solved, "אחד נוחש", "נוחשו")}
        </p>
        {/* Gated on the session for UX only — the API's 401 is the enforcement. */}
        {user ? (
          <Button onClick={() => setAdding(true)} className="gap-1.5">
            <PlusIcon className="size-4" />
            נושא חדש
          </Button>
        ) : null}
      </div>

      <Leaderboard board={standings} />

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
              if (!value.trim()) requestId.current += 1;
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
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2" aria-busy={searching}>
            {displayed.map((theme) => (
              <ThemeCard
                key={theme.id}
                theme={theme}
                highlight={appliedTerm}
              />
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

      {/* Mounted only while open, so the form always starts from fresh state. */}
      {adding ? (
        <ThemeFormDialog
          open
          onOpenChange={setAdding}
          onSuccess={() => router.refresh()}
          members={members}
          nowIso={nowIso}
          defaultBroughtById={defaultBroughtById}
        />
      ) : null}
    </div>
  );
}

function Leaderboard({ board }: { board: Standing[] }) {
  const leaderCount = board[0]?.guesses ?? 0;

  return (
    <section className="bg-card overflow-hidden rounded-2xl border shadow-sm">
      <h2 className="text-muted-foreground border-b px-5 py-3 text-xs font-semibold">
        טבלת המנחשים
      </h2>
      <ol>
        {board.map((entry, index) => {
          // Only a real score can lead — at zero guesses all round, nobody has
          // won anything yet and crowning the first row would be a lie.
          const leading = leaderCount > 0 && entry.guesses === leaderCount;

          return (
            <li
              key={entry.id}
              className={cn(
                "flex items-center gap-3 border-b px-5 py-3 last:border-b-0",
                leading && "bg-accent/60",
                entry.guesses === 0 && "opacity-55",
              )}
            >
              <span className="text-muted-foreground w-5 shrink-0 text-center text-sm font-semibold tabular-nums">
                {placeOf(board, index)}
              </span>

              <PersonAvatar name={entry.name} className="size-9" />

              <div className="min-w-0 flex-1">
                <p className="flex items-center gap-1.5 truncate text-sm font-medium">
                  {entry.name}
                  {leading ? (
                    <CrownIcon className="text-primary size-3.5 shrink-0" />
                  ) : null}
                </p>
                {entry.role ? (
                  <p className="text-muted-foreground truncate text-xs">
                    {entry.role}
                  </p>
                ) : null}
              </div>

              <span className="shrink-0 text-sm font-semibold tabular-nums">
                {entry.guesses}
              </span>
            </li>
          );
        })}
      </ol>
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
          <Highlighted text={theme.theme} term={highlight} />
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
function Highlighted({ text, term }: { text: string; term?: string }) {
  const needle = term?.trim();
  if (!needle) return <>{text}</>;

  const pattern = new RegExp(
    `(${needle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")})`,
    "gi",
  );

  // split() with a capture group puts the matches at the odd indices.
  return (
    <>
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
    </>
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
