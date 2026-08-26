"use client";

import { useEffect, useRef, useState } from "react";
import { CoffeeIcon, DicesIcon, MapPinIcon, PencilIcon } from "lucide-react";

import { RotationWheel, sliceAngle } from "@/components/rotation-wheel";
import { PersonAvatar } from "@/components/person-avatar";
import { MEETUP_COPY, RotationEditor } from "@/components/rotation-editor";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { formatMeetupDate } from "@/lib/format";
import { type RosterMember } from "@/lib/roster";
import {
  buildRotation,
  conjugate,
  currentMeetup,
  daysUntil,
  MEETUP,
  rotate,
  rotationIndex,
} from "@/lib/team";
import { cn } from "@/lib/utils";

const SPIN_MS = 3800;
/** Full turns before it starts hunting for the winner, so it reads as a spin. */
const SPIN_TURNS = 5;

export function MeetupRoulette({
  initialRoster,
  nowIso,
}: {
  /** Who is in the rotation, in stored order, resolved off the server page. */
  initialRoster: RosterMember[];
  /** "Now" is fixed by the server so the first client render matches it. */
  nowIso: string;
}) {
  const now = new Date(nowIso);

  const [winner, setWinner] = useState(0);
  const [rotation, setRotation] = useState(0);
  const [duration, setDuration] = useState(0);
  const [spinning, setSpinning] = useState(false);
  const [editing, setEditing] = useState(false);

  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => clearTimeout(timer.current ?? undefined), []);

  // The editor mutates through the API and then `router.refresh()`, which
  // re-runs the server page and hands down a fresh `initialRoster`. Reconciling
  // during render (not an effect — `react-hooks/set-state-in-effect` is an error
  // here) is the `editRoster` reset the spin state needs: `winner` and
  // `rotation` are positions on a wheel that just changed shape, so they no
  // longer mean anything and must not outlive the list they index into.
  const [seed, setSeed] = useState(initialRoster);
  if (seed !== initialRoster) {
    setSeed(initialRoster);
    setWinner(0);
    setRotation(0);
    setDuration(0);
    setSpinning(false);
  }

  const roster = initialRoster;

  // The rotation as the anchored schedule has it, whoever is up this week first.
  // The editor gets the stable `roster` prop and derives this itself, so its
  // optimistic order re-seeds only when the server hands down a new list — not
  // on every render, which a fresh `rotate(...)` identity each pass would cause.
  const offset = rotationIndex(currentMeetup(now), roster.length);
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

    // Driven by a timer rather than transitionend, which never fires at all
    // when the transition is zero-length for reduced motion.
    timer.current = setTimeout(() => {
      setWinner(next);
      setSpinning(false);
    }, spinMs);
  }

  // One full lap, so everyone can see when their own turn comes round. Empty
  // only on an unseeded database — where there is no wheel to draw yet, just a
  // way in to add the first people.
  const slots =
    queue.length > 0
      ? buildRotation(now, queue.length, rotate(queue, winner))
      : [];
  const thisWeek = slots[0];
  const upcoming = slots.slice(1);

  return (
    <div className="space-y-4">
      {!thisWeek ? (
        <div className="bg-card rounded-2xl border p-8 text-center shadow-sm">
          <CoffeeIcon className="text-muted-foreground mx-auto size-8" />
          <p className="text-muted-foreground mt-3 text-sm text-balance">
            עדיין אין אף אחד בסבב הכיבוד.
          </p>
          <Button className="mt-4" onClick={() => setEditing(true)}>
            הוספת אנשים לסבב
          </Button>
        </div>
      ) : (
        <>
      <div className="bg-card overflow-hidden rounded-2xl border shadow-sm">
        {/* This week, above the wheel — the answer people came for. */}
        <div className="bg-accent text-accent-foreground relative border-b p-5 ps-6">
          <span
            aria-hidden
            className="bg-primary absolute inset-y-0 start-0 w-1.5"
          />

          <div className="flex flex-wrap items-center justify-between gap-2">
            <Badge>השבוע</Badge>
            <span className="text-xs font-medium">
              {daysUntil(thisWeek.date, now)}
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
                  : `${conjugate(thisWeek.member, "מביא", "מביאה")} את הכיבוד`}
              </p>
            </div>
          </div>

          {/* Announced only once the wheel stops — a live region updated mid-spin
              would read out the whole team. */}
          <p className="sr-only" aria-live="polite">
            {spinning
              ? ""
              : `${thisWeek.member.name} ${conjugate(
                  thisWeek.member,
                  "מביא",
                  "מביאה",
                )} את הכיבוד השבוע`}
          </p>

          <dl className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-current/10 pt-3 text-sm">
            <div className="flex items-center gap-1.5">
              <dt className="sr-only">מתי</dt>
              <dd>
                {formatMeetupDate(thisWeek.date)}, {MEETUP.time}
              </dd>
            </div>
            <div className="flex items-center gap-1.5 opacity-80">
              <dt>
                <MapPinIcon className="size-3.5" aria-label="איפה" />
              </dt>
              <dd>{MEETUP.place}</dd>
            </div>
          </dl>
        </div>

        <div className="p-6">
          <RotationWheel
            members={queue}
            rotation={rotation}
            durationMs={duration}
            spinning={spinning}
          />

          <div className="mt-6 flex items-center justify-center gap-2">
            <Button onClick={spin} disabled={spinning} size="lg" className="gap-2">
              <DicesIcon className={cn("size-4", spinning && "animate-spin")} />
              {spinning ? "מסתובב…" : "סובבו את הגלגל"}
            </Button>
            <Button
              variant="outline"
              size="lg"
              disabled={spinning}
              onClick={() => setEditing(true)}
              aria-label="עריכת סבב הכיבוד"
            >
              <PencilIcon className="size-4" />
            </Button>
          </div>

          <p className="text-muted-foreground mt-3 text-center text-xs text-balance">
            התור מתגלגל לבד בכל שבוע. הגלגל הוא בשביל השבועות שבהם הוא לא מסתדר.
          </p>
        </div>
      </div>

      <section className="bg-card overflow-hidden rounded-2xl border shadow-sm">
        <h2 className="text-muted-foreground border-b px-5 py-3 text-xs font-semibold">
          השבועות הבאים
        </h2>
        <ol>
          {upcoming.map((slot, index) => (
            <li
              key={slot.date}
              // Further out reads fainter, but with a floor — the person at the
              // bottom of the lap still has to be able to read their own name.
              style={{ opacity: Math.max(0.6, 1 - index * 0.08) }}
              className="flex items-center gap-3 border-b px-5 py-3 last:border-b-0"
            >
              <PersonAvatar
                name={slot.member.name}
                className="size-8 text-sm"
              />

              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">
                  {slot.member.name}
                </p>
                <p className="text-muted-foreground truncate text-xs">
                  {slot.member.role}
                </p>
              </div>

              <span className="text-muted-foreground shrink-0 text-xs">
                {formatMeetupDate(slot.date)}
              </span>
            </li>
          ))}
        </ol>
      </section>
        </>
      )}

      {/* Mounted only while open, so each visit starts from the list itself. */}
      {editing ? (
        <RotationEditor
          open
          onOpenChange={setEditing}
          roster={roster}
          slots={buildRotation(now, queue.length, queue)}
          offset={offset}
          copy={MEETUP_COPY}
        />
      ) : null}
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
