"use client";

import { useEffect, useRef, useState } from "react";
import {
  DicesIcon,
  ClockIcon,
  HashIcon,
  LifeBuoyIcon,
  SirenIcon,
} from "lucide-react";

import { PersonAvatar } from "@/components/person-avatar";
import { RotationWheel, sliceAngle } from "@/components/rotation-wheel";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { formatDayMonth, formatWeekRange } from "@/lib/format";
import {
  SHOTEF,
  buildShifts,
  currentShift,
  handoverOf,
  shiftIndex,
} from "@/lib/shotef-schema";
import { conjugate, daysUntil, rotate, type Member } from "@/lib/team";
import { cn } from "@/lib/utils";

const SPIN_MS = 3800;
/** Full turns before it starts hunting for the winner, so it reads as a spin. */
const SPIN_TURNS = 5;

export function ShotefRoulette({
  roster,
  nowIso,
}: {
  /** The on-call order. Hard-coded for now; a prop so the page owns the source. */
  roster: Member[];
  /** "Now" is fixed by the server so the first client render matches it. */
  nowIso: string;
}) {
  const now = new Date(nowIso);

  const [winner, setWinner] = useState(0);
  const [rotation, setRotation] = useState(0);
  const [duration, setDuration] = useState(0);
  const [spinning, setSpinning] = useState(false);

  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => clearTimeout(timer.current ?? undefined), []);

  // The queue as the anchored schedule has it, whoever is on duty now first.
  const offset = shiftIndex(currentShift(now), roster.length);
  const queue = rotate(roster, offset);

  function spin() {
    if (spinning || queue.length === 0) return;

    const next = randomSlice(queue.length);
    const slice = sliceAngle(queue.length);

    // Landing angle for a slice is just its negated centre. Rotation only ever
    // grows, so add whole turns until the target is ahead of where we are.
    const target = ((-next * slice) % 360 + 360) % 360;
    const ahead = ((target - (rotation % 360)) % 360 + 360) % 360;
    const spinMs = prefersReducedMotion() ? 0 : SPIN_MS;

    setSpinning(true);
    setDuration(spinMs);
    setRotation(rotation + SPIN_TURNS * 360 + ahead);

    // A timer rather than transitionend, which never fires at all when the
    // transition is zero-length for reduced motion.
    timer.current = setTimeout(() => {
      setWinner(next);
      setSpinning(false);
    }, spinMs);
  }

  // One full lap, so everyone can see when their own week comes round.
  const shifts = buildShifts(now, queue.length, rotate(queue, winner));
  const thisWeek = shifts[0];
  const upcoming = shifts.slice(1);

  return (
    <div className="space-y-4">
      <div className="bg-card overflow-hidden rounded-2xl border shadow-sm">
        {/* Who is on duty, above the wheel — the answer people came for. */}
        <div className="bg-accent text-accent-foreground relative border-b p-5 ps-6">
          <span
            aria-hidden
            className="bg-primary absolute inset-y-0 start-0 w-1.5"
          />

          <div className="flex flex-wrap items-center justify-between gap-2">
            <Badge className="gap-1">
              <SirenIcon className="size-3" />
              שוטף השבוע
            </Badge>
            {/* Counted to the handover, not to the start — what matters when
                you are on duty is how much of the week is left. */}
            <span className="text-xs font-medium">
              התורנות עוברת {daysUntil(handoverOf(thisWeek.date), now)}
            </span>
          </div>

          <div className="mt-4 flex items-center gap-4">
            <PersonAvatar
              name={thisWeek.member.name}
              className="size-16 text-2xl"
            />
            <div className="min-w-0">
              {/* Re-keyed so a new winner fades in rather than swapping out. */}
              <p
                key={thisWeek.member.id}
                className="animate-in fade-in slide-in-from-bottom-1 truncate text-xl font-bold"
              >
                {thisWeek.member.name}
              </p>
              <p className="text-sm opacity-80">
                {spinning
                  ? "מסתובב…"
                  : `${conjugate(thisWeek.member, "אחראי", "אחראית")} על הבאגים והתקלות`}
              </p>
            </div>
          </div>

          {/* Announced only once the wheel stops — a live region updated
              mid-spin would read out the whole team. */}
          <p className="sr-only" aria-live="polite">
            {spinning
              ? ""
              : `${thisWeek.member.name} ${conjugate(
                  thisWeek.member,
                  "השוטף",
                  "השוטפת",
                )} השבוע`}
          </p>

          <dl className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-current/10 pt-3 text-sm">
            <div className="flex items-center gap-1.5">
              <dt className="sr-only">השבוע</dt>
              {/* The span, not its first day — a shift is a whole week. */}
              <dd>{formatWeekRange(thisWeek.date)}</dd>
            </div>
            <div className="flex items-center gap-1.5 opacity-80">
              <dt>
                <HashIcon className="size-3.5" aria-label="איפה לפנות" />
              </dt>
              <dd>{SHOTEF.channel}</dd>
            </div>
            <div className="flex items-center gap-1.5 opacity-80">
              <dt>
                <ClockIcon className="size-3.5" aria-label="שעות זמינות" />
              </dt>
              <dd>{SHOTEF.hours}</dd>
            </div>
          </dl>
        </div>

        <div className="p-6">
          <RotationWheel
            members={queue}
            rotation={rotation}
            durationMs={duration}
            spinning={spinning}
            icon={LifeBuoyIcon}
          />

          <div className="mt-6 flex justify-center">
            <Button onClick={spin} disabled={spinning} size="lg" className="gap-2">
              <DicesIcon className={cn("size-4", spinning && "animate-spin")} />
              {spinning ? "מסתובב…" : "סובבו את הגלגל"}
            </Button>
          </div>

          <p className="text-muted-foreground mt-3 text-center text-xs text-balance">
            התורנות מתגלגלת לבד בכל יום ראשון. הגלגל הוא בשביל השבועות שבהם
            צריך להחליף.
          </p>
        </div>
      </div>

      <section className="bg-card overflow-hidden rounded-2xl border shadow-sm">
        <h2 className="text-muted-foreground border-b px-5 py-3 text-xs font-semibold">
          השבועות הבאים
        </h2>
        <ol>
          {upcoming.map((shift, index) => (
            <li
              key={shift.date}
              // Further out reads fainter, but with a floor — the person at the
              // bottom of the lap still has to be able to read their own name.
              style={{ opacity: Math.max(0.6, 1 - index * 0.08) }}
              className="flex items-center gap-3 border-b px-5 py-3 last:border-b-0"
            >
              <PersonAvatar name={shift.member.name} className="size-8 text-sm" />

              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">
                  {shift.member.name}
                </p>
                <p className="text-muted-foreground truncate text-xs">
                  {shift.member.role}
                </p>
              </div>

              {/* The day the week opens, not its range: a range that crosses a
                  month is long enough to squeeze the name beside it. */}
              <span className="text-muted-foreground shrink-0 text-xs">
                {formatDayMonth(shift.date)}
              </span>
            </li>
          ))}
        </ol>
      </section>
    </div>
  );
}

/**
 * A uniform slice index. Kept at module scope, like `prefersReducedMotion`
 * below, so the RNG is not read as render-time impurity — the spin is an event
 * handler, and the compiler only sees a plain call here.
 */
function randomSlice(size: number): number {
  return Math.floor(Math.random() * size);
}

/** Someone who asked the OS for less motion should get the result, not the ride. */
function prefersReducedMotion(): boolean {
  return (
    typeof window !== "undefined" &&
    window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true
  );
}
