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
  TrophyIcon,
  WorkflowIcon,
  ZapIcon,
  type LucideIcon,
} from "lucide-react";

import { PersonAvatar } from "@/components/person-avatar";
import { formatDuration, formatSaidAtShort, plural } from "@/lib/format";
import {
  byNewest,
  fastestFix,
  solverBoard,
  solversOf,
  type AwardIcon,
  type SolvedMonitor,
  type Solver,
} from "@/lib/shotef";
import { conjugate, type Member } from "@/lib/team";
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

export function HallOfFame({ monitors }: { monitors: SolvedMonitor[] }) {
  const board = solverBoard(monitors);

  return (
    <div className="space-y-4">
      <TrophyCase monitors={monitors} board={board} />
      {board.length > 1 ? <Podium board={board} /> : null}

      <section className="space-y-3">
        <h2 className="text-muted-foreground text-xs font-semibold">
          כל ההישגים
        </h2>

        {/*
          Two to a shelf. The columns are set flush against each other and the
          cards keep their distance with their own padding instead of a grid
          gap, so the two shelves meet at the column boundary and read as one
          board. Below `sm` there is one column, and every plaque gets a shelf
          of its own — which is also what the last plaque of an odd wall gets.
        */}
        <ol className="grid gap-y-7 sm:grid-cols-2 sm:gap-x-0">
          {byNewest(monitors).map((monitor, index, wall) => {
            // Which column the plaque stands in, and whether it is the odd one
            // out at the end of the wall — which keeps a whole shelf, borders
            // and corners intact, rather than half of one.
            const opens = index % 2 === 0;
            const alone = opens && index === wall.length - 1;

            return (
              <li key={monitor.id} className="flex flex-col">
                <div
                  className={cn("flex-1", opens ? "sm:pe-2" : "sm:ps-2")}
                >
                  {/* Stretched, so both plaques on a shelf stand the same
                      height and their bases actually rest on it. */}
                  <Plaque monitor={monitor} />
                </div>
                <Shelf
                  seam={alone ? undefined : opens ? "end" : "start"}
                />
              </li>
            );
          })}
        </ol>
      </section>
    </div>
  );
}

/** The case the whole wall sits in — the count, and the three numbers on it. */
function TrophyCase({
  monitors,
  board,
}: {
  monitors: SolvedMonitor[];
  board: Solver[];
}) {
  const fastest = fastestFix(monitors);
  const leader = board[0];

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
        <Stat label="פותרים" value={String(board.length)} />
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
 * third, with the winner raised.
 */
function Podium({ board }: { board: Solver[] }) {
  const [first, second, third] = board;
  // Written in rank order and re-ordered visually with `order`, so the list
  // reads 1-2-3 to a screen reader while the columns read 2-1-3 on screen.
  // `flatMap` rather than `filter`, so a board of two narrows to the two rows
  // that exist instead of leaving the third `undefined` for every use below.
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

/**
 * The board the plaques stand on: a lit top edge, and the shadow it throws on
 * the wall behind it. Neutrals only — the palette has one hue and it is spoken
 * for. Decorative throughout.
 *
 * Each plaque carries half a shelf, and `seam` is the side where its half meets
 * the other one: that edge loses its border and its rounding, so the two halves
 * read as a single board rather than as two planks pushed together.
 */
function Shelf({ seam }: { seam?: "start" | "end" }) {
  return (
    <div aria-hidden>
      <div
        className={cn(
          "from-muted-foreground/45 to-muted-foreground/25 border-border h-3.5 rounded-[3px] border bg-gradient-to-b shadow-md",
          seam === "end" && "sm:rounded-e-none sm:border-e-0",
          seam === "start" && "sm:rounded-s-none sm:border-s-0",
        )}
      />
      <div
        className={cn(
          "bg-foreground/20 mx-4 h-2 rounded-b-md",
          seam === "end" && "sm:me-0 sm:rounded-ee-none",
          seam === "start" && "sm:ms-0 sm:rounded-es-none",
        )}
      />
    </div>
  );
}

/**
 * One award, drawn as a certificate: a ruled frame inside the card's own
 * border, corner marks, a seal, and a signature block at the foot. Squarer
 * corners than the cards elsewhere in the app, on purpose — the formality is
 * the point, and it is what separates a citation from a list item.
 */
function Plaque({ monitor }: { monitor: SolvedMonitor }) {
  const solvers = solversOf(monitor);
  const Icon = AWARD_ICONS[monitor.icon];

  return (
    <article className="bg-card relative flex h-full flex-col rounded-md border p-2 shadow-sm transition-shadow hover:shadow-md">
      {/* The ruled frame, and the four corner marks on it. */}
      <span
        aria-hidden
        className="border-primary/25 pointer-events-none absolute inset-2 rounded-[2px] border"
      />
      {CORNERS.map((corner) => (
        <span
          key={corner}
          aria-hidden
          className={cn(
            "border-primary/60 pointer-events-none absolute size-3",
            corner,
          )}
        />
      ))}

      <div className="relative flex flex-1 flex-col items-center px-4 py-6 text-center">
        <p className="text-muted-foreground flex w-full items-center gap-2 text-[10px] font-semibold tracking-widest">
          <span aria-hidden className="bg-border h-px flex-1" />
          תעודת הוקרה
          <span aria-hidden className="bg-border h-px flex-1" />
        </p>

        {/* The seal. */}
        <span className="bg-primary text-primary-foreground ring-primary/30 ring-offset-card mt-5 flex size-14 items-center justify-center rounded-full shadow-sm ring-2 ring-offset-2">
          <Icon className="size-6" />
        </span>

        {/* The monitor is the title. Quoted exactly as the alerting system
            spells it — LTR and monospaced, so it can be searched for there
            letter by letter rather than translated back from memory. */}
        <h3
          dir="ltr"
          className="mt-4 font-mono text-[15px] leading-snug font-semibold break-words"
        >
          {monitor.monitor}
        </h3>

        <Rule />

        <p className="text-muted-foreground text-[10px] font-semibold tracking-widest">
          איך פתרנו
        </p>
        {/* The citation itself. Read as prose, so it keeps its own alignment
            while everything around it stays centred on the page's axis. */}
        <p className="mt-2 flex-1 text-start text-sm leading-relaxed">
          {monitor.solution}
        </p>

        {/* The signature block: flex-1 above it pins it to the foot, so two
            certificates on one shelf sign on the same line. */}
        <div className="mt-5 w-full">
          <span aria-hidden className="bg-border mx-auto block h-px w-2/3" />
          <p className="text-muted-foreground mt-2 text-[10px] tracking-widest">
            מוענקת ל
          </p>
          {/* One line per name. A certificate with three recipients lists them;
              it does not squeeze them onto one line and truncate the third. */}
          <ul className="mt-1.5 flex flex-col items-center gap-1.5">
            {(solvers.length > 0 ? solvers : [UNKNOWN]).map((solver) => (
              <li key={solver.id} className="flex items-center gap-2">
                <PersonAvatar name={solver.name} className="size-7 text-xs" />
                <span className="text-sm font-bold">{solver.name}</span>
              </li>
            ))}
          </ul>
          <p className="text-muted-foreground mt-1.5 text-xs">
            {formatSaidAtShort(monitor.solvedAt)} · {solvedVerb(solvers)} תוך{" "}
            {formatDuration(monitor.minutesToFix)}
          </p>
        </div>
      </div>
    </article>
  );
}

/** Nobody on the roster answers for this one any more. */
const UNKNOWN: Member = {
  id: "unknown",
  name: "לא ידוע",
  role: "",
  gender: "m",
};

/**
 * "פתר" / "פתרה" / "פתרו". Hebrew conjugates the verb to the subject, and the
 * past-tense plural is the same for either gender — so more than one name needs
 * no decision about whose gender wins.
 */
function solvedVerb(solvers: Member[]): string {
  if (solvers.length === 0) return "נפתר";
  if (solvers.length === 1) return conjugate(solvers[0], "פתר", "פתרה");
  return "פתרו";
}

/** The four corner marks of the ruled frame, as logical border pairs. */
const CORNERS = [
  "top-2 start-2 border-t-2 border-s-2 rounded-ss-[2px]",
  "top-2 end-2 border-t-2 border-e-2 rounded-se-[2px]",
  "bottom-2 start-2 border-b-2 border-s-2 rounded-es-[2px]",
  "bottom-2 end-2 border-b-2 border-e-2 rounded-ee-[2px]",
] as const;

/** A ruled separator with a mark at its centre — the certificate's own. */
function Rule() {
  return (
    <span
      aria-hidden
      className="my-5 flex w-2/3 items-center justify-center gap-2"
    >
      <span className="bg-border h-px flex-1" />
      <span className="bg-primary/60 size-1.5 rotate-45" />
      <span className="bg-border h-px flex-1" />
    </span>
  );
}
