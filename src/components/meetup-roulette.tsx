"use client";

import { useEffect, useRef, useState } from "react";
import { CoffeeIcon, DicesIcon, MapPinIcon, PencilIcon } from "lucide-react";

import { MeetupWheel, sliceAngle } from "@/components/meetup-wheel";
import { PersonAvatar } from "@/components/person-avatar";
import { RotationEditor } from "@/components/rotation-editor";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { formatMeetupDate } from "@/lib/format";
import { reorder, type RosterMember } from "@/lib/roster";
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
  /** Who is in the rotation, in stored order. Editable from the wheel. */
  initialRoster: RosterMember[];
  /** "Now" is fixed by the server so the first client render matches it. */
  nowIso: string;
}) {
  const now = new Date(nowIso);

  const [roster, setRoster] = useState(initialRoster);
  /**
   * The wheel's faces never move — `queue` is its fixed layout. What changes is
   * which slice is under the pointer, so the winner is an index into it and the
   * schedule is the queue re-seated to start there.
   */
  const [winner, setWinner] = useState(0);
  const [rotation, setRotation] = useState(0);
  const [duration, setDuration] = useState(0);
  const [spinning, setSpinning] = useState(false);
  const [editing, setEditing] = useState(false);

  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => clearTimeout(timer.current ?? undefined), []);

  const active = roster.filter((member) => member.active);
  // The rotation as the anchored schedule has it, whoever is up this week
  // first. The editor never has to know how that is worked out — it hands back
  // the order it displayed, and `reorder` turns the cycle back by the offset.
  const offset = rotationIndex(currentMeetup(now), active.length);
  const queue = rotate(active, offset);
  const slice = sliceAngle(queue.length);

  // One full lap, so everyone can see when their own turn comes round.
  const slots = buildRotation(now, queue.length, rotate(queue, winner));
  const [thisWeek, ...upcoming] = slots;

  function editRoster(next: RosterMember[]) {
    setRoster(next);

    // `winner` and `rotation` are positions on a wheel that just changed shape,
    // so they no longer mean anything. Snapping back to the real schedule is
    // both the honest answer and the one that needs no animation.
    setWinner(0);
    setDuration(0);
    setRotation(0);
  }

  function spin() {
    if (spinning) return;

    const next = Math.floor(Math.random() * queue.length);

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

  return (
    <div className="space-y-4">
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
          <MeetupWheel
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

      <p className="text-muted-foreground flex items-center gap-1.5 text-xs">
        <CoffeeIcon className="size-3.5 shrink-0" />
        כרגע הכול נתונים מקומיים — רענון הדף מחזיר את התור למקומו.
      </p>

      {/* Mounted only while open, so each visit starts from the list itself. */}
      {editing ? (
        <RotationEditor
          open
          onOpenChange={setEditing}
          roster={roster}
          queue={queue}
          slots={buildRotation(now, queue.length, queue)}
          onChange={editRoster}
          onReorder={(next) => editRoster(reorder(roster, next, offset))}
        />
      ) : null}
    </div>
  );
}

/** Someone who asked the OS for less motion should get the result, not the ride. */
function prefersReducedMotion(): boolean {
  return (
    typeof window !== "undefined" &&
    window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true
  );
}
