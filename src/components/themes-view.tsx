"use client";

import { useCallback, useState } from "react";
import { useRouter } from "next/navigation";
import { CrownIcon, LightbulbIcon, Loader2Icon, PlusIcon } from "lucide-react";
import { toast } from "sonner";

import { PersonAvatar } from "@/components/person-avatar";
import { useSession } from "@/components/session-provider";
import { ThemeFormDialog } from "@/components/theme-form-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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
  const router = useRouter();
  const user = useSession();

  // router.refresh() re-runs the server component and hands us a new `initial`.
  // Adjusting during render (rather than in an effect) drops the extra paint —
  // and `react-hooks/set-state-in-effect` is an error in this config anyway.
  const [seed, setSeed] = useState(initial);
  if (seed !== initial) {
    setSeed(initial);
    setThemes(initial.themes);
    setHasMore(initial.hasMore);
  }

  const loadMore = useCallback(async () => {
    if (loading || !hasMore) return;
    setLoading(true);
    try {
      const response = await fetch(
        `/api/themes?skip=${themes.length}&limit=${THEME_PAGE_SIZE}`,
      );
      if (!response.ok) throw new Error(String(response.status));

      const page: ThemePage = await response.json();
      setThemes((current) => {
        const seen = new Set(current.map((theme) => theme.id));
        return [...current, ...page.themes.filter((t) => !seen.has(t.id))];
      });
      setHasMore(page.hasMore);
    } catch {
      toast.error("לא הצלחנו לטעון עוד נושאים");
      setHasMore(false);
    } finally {
      setLoading(false);
    }
  }, [hasMore, loading, themes.length]);

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
        {themes.map((theme) => (
          <ThemeCard key={theme.id} theme={theme} />
        ))}

        {hasMore ? (
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

function ThemeCard({ theme }: { theme: Theme }) {
  return (
    <article className="bg-card rounded-2xl border p-5 shadow-sm">
      <header className="flex items-center gap-3">
        <PersonAvatar name={theme.broughtBy} className="size-9 text-sm" />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium">{theme.broughtBy}</p>
          <p className="text-muted-foreground truncate text-xs">
            {formatMeetupDate(theme.date)}
          </p>
        </div>
      </header>

      <p className="mt-3 flex items-start gap-2 text-lg leading-snug font-semibold text-balance">
        <LightbulbIcon className="text-primary mt-1 size-4 shrink-0" />
        {theme.theme}
      </p>

      {theme.snacks.length > 0 ? (
        <ul className="mt-3 flex flex-wrap gap-1.5">
          {theme.snacks.map((snack) => (
            <li key={snack}>
              <Badge variant="outline" className="font-normal">
                {snack}
              </Badge>
            </li>
          ))}
        </ul>
      ) : null}

      <footer className="mt-4 border-t pt-3 text-sm">
        {theme.guessedBy ? (
          <span className="flex items-center gap-2">
            <PersonAvatar name={theme.guessedBy} className="size-6 text-xs" />
            {/* Passive "was guessed by" agrees with the theme, never the
                guesser — so a guesser who has left the rotation (and whose
                gender we no longer hold) still reads correctly. */}
            <span>
              נוחש על ידי{" "}
              <span className="font-medium">{theme.guessedBy}</span>
            </span>
          </span>
        ) : (
          <span className="text-muted-foreground">אף אחד לא ניחש</span>
        )}
      </footer>
    </article>
  );
}
