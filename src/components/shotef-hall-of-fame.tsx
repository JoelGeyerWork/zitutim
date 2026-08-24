import {
  CpuIcon,
  DatabaseBackupIcon,
  FlameIcon,
  GaugeIcon,
  HardDriveIcon,
  NetworkIcon,
  RefreshCwIcon,
  SearchIcon,
  ShieldCheckIcon,
  TimerIcon,
  TrophyIcon,
  WorkflowIcon,
  ZapIcon,
  type LucideIcon,
} from "lucide-react";

import { PersonAvatar } from "@/components/person-avatar";
import { formatDuration, formatSaidAtShort, plural } from "@/lib/format";
import {
  SEVERITY_LABELS,
  byFame,
  countBySeverity,
  fastestFix,
  memberById,
  solverBoard,
  type AwardIcon,
  type MonitorSeverity,
  type SolvedMonitor,
  type Solver,
} from "@/lib/shotef";
import { conjugate } from "@/lib/team";
import { cn } from "@/lib/utils";

/** What the fix was about, as a face on the medallion. */
const AWARD_ICONS: Record<AwardIcon, LucideIcon> = {
  memory: CpuIcon,
  loop: RefreshCwIcon,
  certificate: ShieldCheckIcon,
  fire: FlameIcon,
  disk: HardDriveIcon,
  network: NetworkIcon,
  cache: ZapIcon,
  backup: DatabaseBackupIcon,
  latency: GaugeIcon,
  pipeline: WorkflowIcon,
  index: SearchIcon,
};

/**
 * Red is the only chromatic hue here, so a tier cannot be spelled in colour the
 * way a medal would be. It is spelled in *weight* instead: the loudest monitor
 * gets the struck medallion and the filled pill, the quietest an outline.
 */
const SEVERITY_STYLE: Record<
  MonitorSeverity,
  { medallion: string; pill: string; rail: boolean }
> = {
  critical: {
    medallion: "bg-primary text-primary-foreground ring-primary/30",
    pill: "bg-primary text-primary-foreground",
    rail: true,
  },
  major: {
    medallion: "bg-primary/10 text-primary ring-primary/25",
    pill: "bg-secondary text-secondary-foreground",
    rail: false,
  },
  minor: {
    medallion: "bg-muted text-muted-foreground ring-border",
    pill: "text-muted-foreground border border-border",
    rail: false,
  },
};

export function HallOfFame({ monitors }: { monitors: SolvedMonitor[] }) {
  const board = solverBoard(monitors);

  return (
    <div className="space-y-4">
      <TrophyCase monitors={monitors} leader={board[0]} />
      {board.length > 1 ? <Podium board={board} /> : null}

      <section className="space-y-3">
        <h2 className="text-muted-foreground text-xs font-semibold">
          כל ההישגים
        </h2>
        {/* Ordered by weight rather than by date: a wall, not a timeline. */}
        {byFame(monitors).map((monitor) => (
          <Plaque key={monitor.id} monitor={monitor} />
        ))}
      </section>
    </div>
  );
}

/** The case the whole wall sits in — the count, and the three numbers on it. */
function TrophyCase({
  monitors,
  leader,
}: {
  monitors: SolvedMonitor[];
  leader?: Solver;
}) {
  const fastest = fastestFix(monitors);

  return (
    <section className="bg-accent text-accent-foreground relative overflow-hidden rounded-2xl border border-transparent p-5">
      {/* A glow behind the trophy, in the one hue the palette has. Decorative,
          and clipped by the card's own rounding. */}
      <span
        aria-hidden
        className="bg-primary/10 pointer-events-none absolute -top-16 -start-16 size-48 rounded-full blur-2xl"
      />

      <div className="relative flex items-center gap-4">
        <span className="bg-primary text-primary-foreground ring-primary/25 ring-offset-accent flex size-14 shrink-0 items-center justify-center rounded-full shadow-sm ring-2 ring-offset-2">
          <TrophyIcon className="size-7" />
        </span>
        <div className="min-w-0">
          <p className="text-xl font-bold">
            {plural(monitors.length, "הישג אחד", "הישגים")}
          </p>
          <p className="mt-0.5 text-sm opacity-80 text-balance">
            כל מוניטור כאן צעק פעם, ומישהו בתורנות השתיק אותו לתמיד.
          </p>
        </div>
      </div>

      <dl className="relative mt-4 grid grid-cols-3 gap-2 border-t border-current/10 pt-3 text-center">
        <Stat
          label="קריטיות"
          value={String(countBySeverity(monitors, "critical"))}
        />
        <Stat
          label="התיקון המהיר"
          value={fastest ? formatDuration(fastest.minutesToFix) : "—"}
        />
        <Stat
          label="מוביל הלוח"
          value={leader ? leader.member.name.split(" ")[0] : "—"}
        />
      </dl>
    </section>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <dd className="truncate font-bold tabular-nums">{value}</dd>
      <dt className="text-xs opacity-70">{label}</dt>
    </div>
  );
}

/**
 * The three people with the most plaques, on a real podium: second, first,
 * third, with the winner raised. The order is visual, not semantic — the list
 * itself is still written first-to-third, so it is read in rank order.
 */
function Podium({ board }: { board: Solver[] }) {
  const [first, second, third] = board;
  // `flatMap` rather than `filter`, so a board of two narrows to the two rows
  // that exist instead of leaving the third `undefined` for every use below.
  // Written in rank order and re-ordered visually with `order`, so the list
  // reads 1-2-3 to a screen reader while the columns read 2-1-3 on screen.
  const steps = (
    [
      [first, 1],
      [second, 2],
      [third, 3],
    ] as const
  ).flatMap(([solver, place]) => (solver ? [{ solver, place }] : []));

  return (
    <section className="bg-card rounded-2xl border p-5 shadow-sm">
      <h2 className="text-muted-foreground text-xs font-semibold">
        מי השתיק הכי הרבה
      </h2>

      <ol className="mt-4 grid grid-cols-3 items-end gap-2">
        {steps.map(({ solver, place }) => (
          <li
            key={solver.member.id}
            // The winner takes the middle column, the runner-up the one at the
            // start of the row — a podium, whichever direction the page runs in.
            style={{ order: place === 1 ? 2 : place === 2 ? 1 : 3 }}
            // The step is the card itself: taller for the winner, and the row
            // is bottom-aligned, so the three make a podium without a prop.
            className={cn(
              "flex flex-col items-center gap-2 rounded-xl border p-3 text-center",
              place === 1
                ? "bg-accent border-transparent px-3 pt-6 pb-4"
                : "pt-4",
            )}
          >
            <div className="relative">
              <PersonAvatar
                name={solver.member.name}
                className={cn(place === 1 ? "size-14 text-xl" : "size-11")}
              />
              <span
                className={cn(
                  "ring-card absolute -bottom-1 -end-1 flex size-5 items-center justify-center rounded-full text-[10px] font-bold ring-2",
                  place === 1
                    ? "bg-primary text-primary-foreground"
                    : "bg-muted text-muted-foreground",
                )}
              >
                {place}
              </span>
            </div>

            <p className="w-full truncate text-xs font-semibold">
              {solver.member.name}
            </p>
            <p className="text-muted-foreground text-[11px]">
              {plural(solver.solved, "הישג אחד", "הישגים")}
            </p>
          </li>
        ))}
      </ol>
    </section>
  );
}

function Plaque({ monitor }: { monitor: SolvedMonitor }) {
  const solver = memberById(monitor.solvedById);
  const name = solver?.name ?? "לא ידוע";
  const Icon = AWARD_ICONS[monitor.icon];
  const style = SEVERITY_STYLE[monitor.severity];

  return (
    <article className="bg-card relative overflow-hidden rounded-2xl border shadow-sm transition-shadow hover:shadow-md">
      {/* The rail the meetup card uses for "this is the loud one", reused here
          for the tier that earned it. */}
      {style.rail ? (
        <span
          aria-hidden
          className="bg-primary absolute inset-y-0 start-0 w-1.5"
        />
      ) : null}

      <header className={cn("flex items-start gap-4 p-5", style.rail && "ps-6")}>
        <span
          className={cn(
            "ring-offset-card flex size-14 shrink-0 items-center justify-center rounded-full shadow-sm ring-2 ring-offset-2",
            style.medallion,
          )}
        >
          <Icon className="size-6" />
        </span>

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <h3 className="text-lg leading-tight font-bold">{monitor.award}</h3>
            <span
              className={cn(
                "rounded-full px-2 py-0.5 text-[11px] font-medium",
                style.pill,
              )}
            >
              {SEVERITY_LABELS[monitor.severity]}
            </span>
          </div>

          {/* Quoted exactly as the alerting system spells it — LTR and
              monospaced, so it can be searched for there letter by letter
              rather than translated back from memory. */}
          <code
            dir="ltr"
            className="text-muted-foreground mt-2 block truncate font-mono text-xs"
          >
            {monitor.monitor}
          </code>
        </div>
      </header>

      <div className={cn("border-t px-5 py-4", style.rail && "ps-6")}>
        <h4 className="text-muted-foreground text-xs font-semibold">
          איך פתרנו
        </h4>
        <p className="mt-2 text-sm leading-relaxed">{monitor.solution}</p>
      </div>

      {/* The engraved base of the plaque: who, when, how long it took. */}
      <footer
        className={cn(
          "bg-muted/40 flex flex-wrap items-center gap-x-3 gap-y-2 border-t px-5 py-3",
          style.rail && "ps-6",
        )}
      >
        <PersonAvatar name={name} className="size-7 text-xs" />
        <span className="text-sm font-medium">{name}</span>
        <span className="text-muted-foreground text-xs">
          {formatSaidAtShort(monitor.solvedAt)}
        </span>
        <span className="text-muted-foreground ms-auto flex items-center gap-1 text-xs">
          <TimerIcon className="size-3.5" aria-hidden />
          {solver ? conjugate(solver, "פתר", "פתרה") : "נפתר"} תוך{" "}
          {formatDuration(monitor.minutesToFix)}
        </span>
      </footer>
    </article>
  );
}
