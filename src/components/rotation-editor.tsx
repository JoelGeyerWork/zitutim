"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { MoreHorizontalIcon, UserPlusIcon } from "lucide-react";
import { toast } from "sonner";

import {
  DirectorySearch,
  DirectorySearchNote,
} from "@/components/directory-search";
import { PersonAvatar } from "@/components/person-avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { formatDayMonth, formatMeetupDate, plural } from "@/lib/format";
import { type DirectoryPerson } from "@/lib/directory-schema";
import { moveItem, reorder, type RosterMember } from "@/lib/roster";
import { rotate } from "@/lib/team";
import { cn } from "@/lib/utils";

type Gender = "m" | "f";

const JSON_HEADERS = { "Content-Type": "application/json" };

/**
 * One turn as a row spells it. Structural rather than `MeetupSlot | ShotefShift`
 * — all the editor wants to know is which date a position falls on and whether
 * that position is the one running now.
 */
type Turn = { date: string; weeksAway: number };

/**
 * Everything that differs between the two rotations this editor drives: where
 * it writes, and what it calls things.
 *
 * One editor rather than two, for the same reason both rotations are one
 * collection behind a key (`rotation.ts`): the drag, the optimistic list and
 * the 401 handling are subtle enough that a second copy is a second copy to
 * keep in agreement. Both configurations live here, side by side, so a field
 * added to one cannot be quietly forgotten on the other.
 *
 * The three prepositional forms are separate fields rather than built from a
 * single noun: Hebrew folds the preposition into the definite article
 * ("בסבב", "מהסבב"), and the two nouns disagree on gender besides ("שבו" vs
 * "שבה"), so a sentence assembled from a stem would be wrong as often as right.
 */
export type RotationCopy = {
  /** REST base. Mutations are `${api}`, `${api}/${userId}` and `${api}/order`. */
  api: string;
  /** The rotation, as the dialog titles it. */
  title: string;
  /** The line under that title on the list view. */
  hint: string;
  /** "…בסבב" — after a count, and after "כבר". */
  inRotation: string;
  /** "…לסבב" — after "הוספה" and after "להוסיף". */
  toRotation: string;
  /** "…מהסבב" — after "הוצאה", "להוציא" and "הוצאו". */
  fromRotation: string;
  /** The tail of the confirm sentence, which turns on the noun's own gender. */
  joinTail: string;
  /** The verb the gender choice is actually choosing between. */
  verb: { f: string; m: string };
  /** What that verb is done to, for the worked example under the choice. */
  verbObject: string;
  /** The closing note on the list view. */
  footnote: string;
  /** A turn's date, as its row spells it. */
  formatTurn: (iso: string) => string;
};

/** The ישב״צ refreshment rotation. */
export const MEETUP_COPY: RotationCopy = {
  api: "/api/rotation",
  title: "סבב הכיבוד",
  hint: "מי מביא כיבוד, ובאיזה סדר. גוררים כדי לשנות.",
  inRotation: "בסבב",
  toRotation: "לסבב",
  fromRotation: "מהסבב",
  joinTail: "לסוף הסבב, שבו יהיו מעכשיו",
  verb: { f: "מביאה", m: "מביא" },
  verbObject: "את הכיבוד",
  footnote:
    "השם והתפקיד מגיעים מספריית הארגון ומתעדכנים משם. הסדר ולשון הפנייה נקבעים כאן — ומי שיוצא מהסבב נשאר רשום על נושאי הכיבוד שהביא.",
  formatTurn: formatMeetupDate,
};

/** The on-call rotation: the same store and the same routes one level down. */
export const SHOTEF_COPY: RotationCopy = {
  api: "/api/shotef/rotation",
  title: "התורנות",
  hint: "מי שוטף, ובאיזה סדר. גוררים כדי לשנות.",
  inRotation: "בתורנות",
  toRotation: "לתורנות",
  fromRotation: "מהתורנות",
  joinTail: "לסוף התורנות, שבה יהיו מעכשיו",
  verb: { f: "שוטפת", m: "שוטף" },
  verbObject: "השבוע",
  footnote:
    "השם והתפקיד מגיעים מספריית הארגון ומתעדכנים משם. הסדר ולשון הפנייה נקבעים כאן — ומי שיוצא מהתורנות נשאר רשום על השבועות שכבר עברו עליו.",
  // The day the week opens, not its range: a range that crosses a month is
  // long enough to squeeze the name beside it.
  formatTurn: formatDayMonth,
};

/**
 * Editing a rotation: who is on the wheel, and in what order.
 *
 * Not a team-management screen. Nobody is created or deleted here — a person
 * exists in the organisation's directory whether or not they bring snacks, and
 * all this decides is which of them the wheel turns through. Removing is
 * *forgetting*: there is no inactive state, no "return to rotation" list. To
 * bring someone back you find them in the directory again; the add lands on
 * their existing `users` row, so their past themes still attribute to them.
 *
 * Every action calls the API and then `router.refresh()`. The list stays
 * optimistic so a drag or a gender flip feels instant — a spinner between each
 * would be worse than a stale row for a beat.
 */
export function RotationEditor({
  open,
  onOpenChange,
  roster,
  slots,
  offset,
  copy,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The stored rotation, resolved off the server page. Stable across renders. */
  roster: RosterMember[];
  /** The next turn per *displayed* row. Computed by the caller, which owns "now". */
  slots: Turn[];
  /** Turns the displayed cycle back into the stored order for a reorder. */
  offset: number;
  /** Which rotation this is editing. Required, because it names the API. */
  copy: RotationCopy;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const loginHref = `/login?next=${encodeURIComponent(pathname)}`;

  const [adding, setAdding] = useState(false);
  const [picked, setPicked] = useState<DirectoryPerson | null>(null);

  // A local optimistic copy of the displayed order — whoever is up this week
  // first — re-seeded whenever the server hands down a fresh `roster` (after a
  // `router.refresh()`). Seed-compared on the stable `roster` identity, like
  // `QuoteFeed`, adjusted during render rather than in an effect.
  const [order, setOrder] = useState(() => rotate(roster, offset));
  const [seed, setSeed] = useState(roster);
  if (seed !== roster) {
    setSeed(roster);
    setOrder(rotate(roster, offset));
  }

  /** 401 means the session lapsed; the API is the enforcement, so go sign in. */
  function guard(status: number): boolean {
    if (status === 401) {
      router.push(loginHref);
      return false;
    }
    return true;
  }

  async function reorderTo(next: RosterMember[]) {
    setOrder(next); // optimistic — the drag has to feel immediate
    const ids = reorder(next, offset).map((member) => member.id);
    try {
      const response = await fetch(`${copy.api}/order`, {
        method: "PUT",
        headers: JSON_HEADERS,
        body: JSON.stringify({ ids }),
      });
      if (!guard(response.status)) return;
      if (!response.ok) toast.error("לא הצלחנו לשמור את הסדר");
      router.refresh();
    } catch {
      toast.error("לא הצלחנו לשמור את הסדר");
      router.refresh();
    }
  }

  async function changeGender(id: string, gender: Gender) {
    setOrder((current) =>
      current.map((member) =>
        member.id === id ? { ...member, gender } : member,
      ),
    );
    try {
      const response = await fetch(`${copy.api}/${id}`, {
        method: "PATCH",
        headers: JSON_HEADERS,
        body: JSON.stringify({ gender }),
      });
      if (!guard(response.status)) return;
      if (!response.ok) toast.error("לא הצלחנו לעדכן");
      router.refresh();
    } catch {
      toast.error("לא הצלחנו לעדכן");
      router.refresh();
    }
  }

  async function remove(id: string) {
    try {
      const response = await fetch(`${copy.api}/${id}`, {
        method: "DELETE",
        headers: JSON_HEADERS,
      });
      if (!guard(response.status)) return;
      if (response.status === 409) {
        toast.error(`צריך שיישאר לפחות אדם אחד ${copy.inRotation}`);
      } else if (!response.ok) {
        toast.error(`לא הצלחנו להוציא ${copy.fromRotation}`);
      } else {
        toast.success(`הוצאו ${copy.fromRotation}`);
      }
      router.refresh();
    } catch {
      toast.error(`לא הצלחנו להוציא ${copy.fromRotation}`);
      router.refresh();
    }
  }

  async function add(person: DirectoryPerson, gender: Gender) {
    try {
      const response = await fetch(copy.api, {
        method: "POST",
        headers: JSON_HEADERS,
        body: JSON.stringify({ directoryId: person.directoryId, gender }),
      });
      if (!guard(response.status)) return;
      if (response.status === 409) {
        toast.error(`${person.displayName} כבר ${copy.inRotation}`);
      } else if (!response.ok) {
        toast.error(`לא הצלחנו להוסיף ${copy.toRotation}`);
      } else {
        toast.success(`${person.displayName} נוספו ${copy.toRotation}`);
      }
      router.refresh();
    } catch {
      toast.error(`לא הצלחנו להוסיף ${copy.toRotation}`);
      router.refresh();
    }
    close();
  }

  function close() {
    setAdding(false);
    setPicked(null);
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        onOpenChange(next);
        if (!next) close();
      }}
    >
      <DialogContent className="max-h-[90dvh] gap-5 overflow-y-auto sm:max-w-2xl sm:p-6">
        <DialogHeader>
          <DialogTitle>
            {adding ? `הוספה ${copy.toRotation}` : copy.title}
          </DialogTitle>
          <DialogDescription>
            {adding
              ? "מחפשים בספריית הארגון ובוחרים. השם והתפקיד מגיעים משם."
              : copy.hint}
          </DialogDescription>
        </DialogHeader>

        {picked ? (
          <Confirm
            person={picked}
            rotationSize={order.length}
            copy={copy}
            onBack={() => setPicked(null)}
            onConfirm={(gender) => add(picked, gender)}
          />
        ) : adding ? (
          <Search
            members={order}
            loginHref={loginHref}
            copy={copy}
            onPick={setPicked}
          />
        ) : (
          <div className="min-w-0 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-muted-foreground text-sm">
                {plural(order.length, "אדם אחד", "אנשים")} {copy.inRotation}
              </p>
              <Button
                size="sm"
                onClick={() => setAdding(true)}
                className="gap-1.5"
              >
                <UserPlusIcon className="size-3.5" />
                הוספה
              </Button>
            </div>

            <Sortable
              queue={order}
              slots={slots}
              copy={copy}
              onReorder={reorderTo}
              onGender={changeGender}
              onRemove={remove}
            />

            <p className="text-muted-foreground text-xs text-balance">
              {copy.footnote}
            </p>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

/** How long a touch has to sit still before it is a drag and not a scroll. */
const HOLD_MS = 350;
/** Movement inside this radius is still a hold; past it, it was a scroll. */
const HOLD_SLOP = 8;

type Drag = {
  from: number;
  to: number;
  /** Pointer position when the drag began, and the height of one row. */
  y: number;
  /** How far the held row has travelled, clamped to the ends of the list. */
  dy: number;
  height: number;
};

function Sortable({
  queue,
  slots,
  copy,
  onReorder,
  onGender,
  onRemove,
}: {
  queue: RosterMember[];
  slots: Turn[];
  copy: RotationCopy;
  onReorder: (queue: RosterMember[]) => void;
  onGender: (id: string, gender: Gender) => void;
  onRemove: (id: string) => void;
}) {
  const list = useRef<HTMLOListElement>(null);
  const [drag, setDrag] = useState<Drag | null>(null);

  /**
   * Tracked on the window rather than on the row: a drag that leaves the list
   * sideways, or ends over the page behind the dialog, still has to finish.
   */
  useEffect(() => {
    if (!drag) return;

    function move(event: PointerEvent) {
      const { from, y, height } = drag!;

      // Held inside the list, so the row cannot be dragged off either end.
      const dy = Math.max(
        -from * height,
        Math.min((queue.length - 1 - from) * height, event.clientY - y),
      );

      setDrag({ ...drag!, dy, to: from + Math.round(dy / height) });
    }

    function drop() {
      if (drag!.to !== drag!.from) {
        onReorder(moveItem(queue, drag!.from, drag!.to));
      }
      setDrag(null);
    }

    // Rows are `touch-pan-y` so the dialog scrolls normally; once a drag is
    // under way the scroll has to be refused, and only a non-passive listener
    // is allowed to do that.
    function hold(event: TouchEvent) {
      event.preventDefault();
    }

    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", drop);
    window.addEventListener("pointercancel", drop);
    window.addEventListener("touchmove", hold, { passive: false });

    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", drop);
      window.removeEventListener("pointercancel", drop);
      window.removeEventListener("touchmove", hold);
    };
  }, [drag, queue, onReorder]);

  function grab(event: React.PointerEvent, from: number) {
    // The controls inside a row keep their own gestures.
    if ((event.target as HTMLElement).closest("[data-no-drag]")) return;
    if (event.button !== 0) return;

    // Every row is the same height, so one measurement converts the pointer's
    // travel into positions without tracking each row's box.
    const height =
      list.current?.firstElementChild?.getBoundingClientRect().height ?? 0;
    if (height === 0) return;

    const { clientX, clientY } = event;
    const start = () => setDrag({ from, to: from, y: clientY, dy: 0, height });

    if (event.pointerType !== "touch") {
      event.preventDefault();
      start();
      return;
    }

    // On touch the whole row is the only handle there is, and grabbing it on
    // contact would take the dialog's scroll with it. So it has to be held
    // still first, and any real movement inside that window was a scroll.
    const timer = setTimeout(() => {
      stop();
      start();
    }, HOLD_MS);

    function slip(move: PointerEvent) {
      if (Math.hypot(move.clientX - clientX, move.clientY - clientY) > HOLD_SLOP) {
        stop();
      }
    }

    function stop() {
      clearTimeout(timer);
      window.removeEventListener("pointermove", slip);
      window.removeEventListener("pointerup", stop);
      window.removeEventListener("pointercancel", stop);
    }

    window.addEventListener("pointermove", slip);
    window.addEventListener("pointerup", stop);
    window.addEventListener("pointercancel", stop);
  }

  /** Dragging is a pointer gesture, so the row answers the arrows too. */
  function nudge(event: React.KeyboardEvent, from: number) {
    const step = event.key === "ArrowUp" ? -1 : event.key === "ArrowDown" ? 1 : 0;
    const to = from + step;
    if (step === 0 || to < 0 || to >= queue.length) return;

    event.preventDefault();
    onReorder(moveItem(queue, from, to));
  }

  return (
    <ol
      ref={list}
      className={cn(
        "divide-y overflow-hidden rounded-xl border",
        drag && "cursor-grabbing select-none",
      )}
    >
      {queue.map((member, index) => {
        const held = drag?.from === index;

        // The rows the held one has passed step aside by exactly one place;
        // the held row itself follows the pointer.
        const shift =
          !drag || held
            ? 0
            : index > drag.from && index <= drag.to
              ? -drag.height
              : index >= drag.to && index < drag.from
                ? drag.height
                : 0;

        // A week belongs to its position in the list, not to the person — so
        // the dates stay put and the person moves between them.
        const turn = slots[held ? drag!.to : index + Math.sign(shift)];
        const offset = held ? drag!.dy : shift;

        return (
          <li
            key={member.id}
            tabIndex={0}
            onPointerDown={(event) => grab(event, index)}
            onKeyDown={(event) => nudge(event, index)}
            style={{ transform: offset ? `translateY(${offset}px)` : undefined }}
            className={cn(
              "relative flex flex-wrap items-center gap-3 px-3 py-3 sm:flex-nowrap sm:px-4",
              "cursor-grab touch-pan-y outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary/40",
              turn?.weeksAway === 0 && "bg-accent/60",
              held
                ? // Lifted out of the list and tracking the pointer directly,
                  // so it gets no transition of its own. The ring is inset
                  // because the list clips at its own rounded edge.
                  "bg-card ring-primary/40 z-20 cursor-grabbing shadow-lg ring-2 ring-inset"
                : "transition-transform duration-150",
            )}
          >
            <PersonAvatar name={member.name} className="size-10" />

            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium">{member.name}</p>
              <p className="text-muted-foreground truncate text-xs">
                {member.role}
                {member.role && turn ? " · " : null}
                {turn?.weeksAway === 0 ? (
                  <span className="text-foreground font-medium">השבוע</span>
                ) : turn ? (
                  copy.formatTurn(turn.date)
                ) : null}
              </p>
            </div>

            {/* Inline where there is room; below the name where there is not,
                since a truncated name is worse than a second line. */}
            <GenderChoice
              value={member.gender}
              verb={copy.verb}
              onChange={(gender) => onGender(member.id, gender)}
              className="order-last w-full sm:order-none sm:w-auto"
            />

            <DropdownMenu>
              <DropdownMenuTrigger
                render={
                  <Button
                    data-no-drag
                    variant="ghost"
                    size="icon"
                    className="size-8 shrink-0"
                  />
                }
              >
                <MoreHorizontalIcon className="size-4" />
                <span className="sr-only">פעולות על {member.name}</span>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem
                  variant="destructive"
                  // A rotation with nobody in it has no turn to render, which
                  // is why the API refuses this one with a 409 as well.
                  disabled={queue.length === 1}
                  onClick={() => onRemove(member.id)}
                >
                  הוצאה {copy.fromRotation}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </li>
        );
      })}
    </ol>
  );
}

/**
 * Adding somebody is picking them out of the directory, never typing a name —
 * so they arrive with their real objectGUID, and the rotation entry and the row
 * their next sign-in touches are the same row.
 *
 * The search itself is `DirectorySearch`, shared with the two שוטף forms. All
 * that is rotation-specific is what a result row offers, which is the one thing
 * that component leaves to its caller: somebody already on the wheel is a badge
 * saying so, not a second way to add them.
 */
function Search({
  members,
  loginHref,
  copy,
  onPick,
}: {
  members: RosterMember[];
  loginHref: string;
  copy: RotationCopy;
  onPick: (person: DirectoryPerson) => void;
}) {
  const known = new Set(members.map((member) => member.directoryId));
  const inRotation = (person: DirectoryPerson) => known.has(person.directoryId);

  return (
    <div className="min-w-0 space-y-4">
      <DirectorySearch
        autoFocus
        loginHref={loginHref}
        taken={inRotation}
        action={(person) =>
          inRotation(person) ? (
            <Badge variant="secondary" className="shrink-0 font-normal">
              כבר {copy.inRotation}
            </Badge>
          ) : (
            <Button size="sm" onClick={() => onPick(person)}>
              הוספה
            </Button>
          )
        }
      />
      <DirectorySearchNote />
    </div>
  );
}

function Confirm({
  person,
  rotationSize,
  copy,
  onBack,
  onConfirm,
}: {
  person: DirectoryPerson;
  rotationSize: number;
  copy: RotationCopy;
  onBack: () => void;
  onConfirm: (gender: Gender) => void;
}) {
  const [gender, setGender] = useState<Gender>("f");

  return (
    <div className="min-w-0 space-y-5">
      <div className="bg-muted/40 flex items-center gap-3 rounded-xl border p-4">
        <PersonAvatar name={person.displayName} className="size-10" />
        <div className="min-w-0">
          <p className="truncate text-sm font-medium">{person.displayName}</p>
          <p className="text-muted-foreground truncate text-xs">
            {person.title ? `${person.title} · ` : null}
            <span dir="ltr" className="font-mono">
              {person.username}
            </span>
          </p>
        </div>
      </div>

      <div className="space-y-2">
        <p className="text-sm font-semibold">לשון פנייה</p>
        {/* The one field the directory cannot answer, which is why it is asked
            here rather than read. */}
        <GenderChoice
          value={gender}
          verb={copy.verb}
          onChange={setGender}
          className="w-full"
        />
        <p className="text-muted-foreground text-xs">
          כדי לכתוב &rlm;„{copy.verb[gender]} {copy.verbObject}”.
        </p>
      </div>

      <p className="text-muted-foreground text-xs text-balance">
        {person.displayName} {gender === "f" ? "תיכנס" : "ייכנס"} {copy.joinTail}{" "}
        {plural(rotationSize + 1, "אדם אחד", "אנשים")} — כך שהתור של כולם זז
        בשבוע.
      </p>

      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button type="button" variant="outline" size="lg" onClick={onBack}>
          חזרה
        </Button>
        <Button type="button" size="lg" onClick={() => onConfirm(gender)}>
          הוספה {copy.toRotation}
        </Button>
      </div>
    </div>
  );
}

/** Two states, both always visible — a switch would not say what it toggles. */
function GenderChoice({
  value,
  verb,
  onChange,
  className,
}: {
  value: Gender;
  /** The choice is spelled as the verb it conjugates, not as "male"/"female". */
  verb: RotationCopy["verb"];
  onChange: (gender: Gender) => void;
  className?: string;
}) {
  return (
    <div
      data-no-drag
      role="radiogroup"
      aria-label="לשון פנייה"
      className={cn(
        "bg-muted/60 inline-flex shrink-0 rounded-lg border p-0.5",
        className,
      )}
    >
      {(["f", "m"] as const).map((option) => (
        <button
          key={option}
          type="button"
          role="radio"
          aria-checked={value === option}
          onClick={() => onChange(option)}
          className={cn(
            "flex-1 rounded-md px-3 py-1.5 text-xs font-medium transition-colors",
            value === option
              ? "bg-card text-foreground shadow-sm"
              : "text-muted-foreground hover:text-foreground",
          )}
        >
          {verb[option]}
        </button>
      ))}
    </div>
  );
}
