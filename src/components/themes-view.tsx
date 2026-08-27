"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { CrownIcon, PlusIcon } from "lucide-react";

import { PersonAvatar } from "@/components/person-avatar";
import { useSession } from "@/components/session-provider";
import { ThemeFormDialog } from "@/components/theme-form-dialog";
import { ThemeHistory } from "@/components/theme-history";
import { Button } from "@/components/ui/button";
import { plural } from "@/lib/format";
import {
  placeOf,
  type Standing,
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
  const [adding, setAdding] = useState(false);
  const router = useRouter();
  const user = useSession();

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

      <ThemeHistory initial={initial} />

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
