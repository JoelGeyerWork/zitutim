"use client";

import { useEffect, useRef, useState } from "react";
import {
  MoreHorizontalIcon,
  SearchIcon,
  UserPlusIcon,
} from "lucide-react";
import { toast } from "sonner";

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
import { Input } from "@/components/ui/input";
import { formatMeetupDate, plural } from "@/lib/format";
import { searchDirectory, type DirectoryPerson } from "@/lib/directory";
import { fromDirectory, moveItem, type RosterMember } from "@/lib/roster";
import { type MeetupSlot, type Member } from "@/lib/team";
import { cn } from "@/lib/utils";

/**
 * Editing the refreshment rotation: who is on the wheel, and in what order.
 *
 * Not a team-management screen. Nobody is created or deleted here — a person
 * exists in the organisation's directory whether or not they bring snacks, and
 * all this decides is which of them the wheel turns through.
 *
 * Everything one dialog rather than a nested one, so adding somebody is a step
 * inside the list it changes rather than a second window over it.
 */
export function RotationEditor({
  open,
  onOpenChange,
  roster,
  queue,
  slots,
  onChange,
  onReorder,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  roster: RosterMember[];
  /** The rotation from whoever is up this week — the order people think in. */
  queue: RosterMember[];
  /** `queue[i]`'s next turn. Computed by the caller, which owns "now". */
  slots: MeetupSlot[];
  onChange: (roster: RosterMember[]) => void;
  /** Hands back the whole visible order; the caller stores it. */
  onReorder: (queue: RosterMember[]) => void;
}) {
  const [adding, setAdding] = useState(false);
  const [picked, setPicked] = useState<DirectoryPerson | null>(null);

  function add(person: DirectoryPerson, gender: Member["gender"]) {
    onChange([...roster, fromDirectory(person, gender)]);
    toast.success(`${person.displayName} נוספו לסבב`);
    close();
  }

  function setActive(id: string, value: boolean) {
    onChange(
      roster.map((member) =>
        member.id === id ? { ...member, active: value } : member,
      ),
    );
    toast.success(value ? "חזרו לסבב" : "הוצאו מהסבב");
    if (value) close();
  }

  function setGender(id: string, gender: Member["gender"]) {
    onChange(
      roster.map((member) =>
        member.id === id ? { ...member, gender } : member,
      ),
    );
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
          <DialogTitle>{adding ? "הוספה לסבב" : "סבב הכיבוד"}</DialogTitle>
          <DialogDescription>
            {adding
              ? "מחפשים בספריית הארגון ובוחרים. השם והתפקיד מגיעים משם."
              : "מי מביא כיבוד, ובאיזה סדר. גוררים כדי לשנות."}
          </DialogDescription>
        </DialogHeader>

        {picked ? (
          <Confirm
            person={picked}
            rotationSize={queue.length}
            onBack={() => setPicked(null)}
            onConfirm={(gender) => add(picked, gender)}
          />
        ) : adding ? (
          <Search
            roster={roster}
            onPick={setPicked}
            onRestore={(id) => setActive(id, true)}
          />
        ) : (
          <div className="min-w-0 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-muted-foreground text-sm">
                {plural(queue.length, "אדם אחד", "אנשים")} בסבב
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
              queue={queue}
              slots={slots}
              onReorder={onReorder}
              onGender={setGender}
              onRemove={(id) => setActive(id, false)}
            />

            <Former roster={roster} onRestore={(id) => setActive(id, true)} />

            <p className="text-muted-foreground text-xs text-balance">
              השם והתפקיד מגיעים מספריית הארגון ומתעדכנים משם. הסדר, לשון
              הפנייה וההשתתפות בסבב נקבעים כאן — ומי שיוצא מהסבב נשאר רשום על
              נושאי הכיבוד שהביא.
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
  onReorder,
  onGender,
  onRemove,
}: {
  queue: RosterMember[];
  slots: MeetupSlot[];
  onReorder: (queue: RosterMember[]) => void;
  onGender: (id: string, gender: Member["gender"]) => void;
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
              turn.weeksAway === 0 && "bg-accent/60",
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
                {" · "}
                {turn.weeksAway === 0 ? (
                  <span className="text-foreground font-medium">השבוע</span>
                ) : (
                  formatMeetupDate(turn.date)
                )}
              </p>
            </div>

            {/* Inline where there is room; below the name where there is not,
                since a truncated name is worse than a second line. */}
            <GenderChoice
              value={member.gender}
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
                  // Somebody has to bring the refreshments.
                  disabled={queue.length === 1}
                  onClick={() => onRemove(member.id)}
                >
                  הוצאה מהסבב
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </li>
        );
      })}
    </ol>
  );
}

function Former({
  roster,
  onRestore,
}: {
  roster: RosterMember[];
  onRestore: (id: string) => void;
}) {
  const former = roster.filter((member) => !member.active);
  if (former.length === 0) return null;

  return (
    <details className="rounded-xl border px-3 py-2.5 sm:px-4">
      <summary className="text-muted-foreground cursor-pointer text-xs font-semibold">
        לא בסבב ({former.length})
      </summary>
      <ul className="mt-2 divide-y">
        {former.map((member) => (
          <li key={member.id} className="flex items-center gap-3 py-2.5">
            <PersonAvatar name={member.name} className="size-9 text-sm" />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm">{member.name}</p>
              <p className="text-muted-foreground truncate text-xs">
                {member.role}
              </p>
            </div>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => onRestore(member.id)}
            >
              החזרה לסבב
            </Button>
          </li>
        ))}
      </ul>
    </details>
  );
}

/**
 * Adding somebody is picking them out of the directory, never typing a name —
 * so they arrive with their real objectGUID, and the rotation entry and the row
 * their next sign-in touches are the same row.
 */
function Search({
  roster,
  onPick,
  onRestore,
}: {
  roster: RosterMember[];
  onPick: (person: DirectoryPerson) => void;
  onRestore: (id: string) => void;
}) {
  const [query, setQuery] = useState("");

  const results = searchDirectory(query);
  const known = new Map(roster.map((member) => [member.directoryId, member]));

  return (
    <div className="min-w-0 space-y-4">
      <div className="relative">
        <SearchIcon className="text-muted-foreground pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2" />
        <Input
          autoFocus
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="שם או שם משתמש"
          aria-label="חיפוש בספריית הארגון"
          className="ps-9"
        />
      </div>

      {query.trim().length < 2 ? (
        <p className="text-muted-foreground py-6 text-center text-sm">
          לפחות שתי אותיות.
        </p>
      ) : results.length === 0 ? (
        <p className="text-muted-foreground py-6 text-center text-sm">
          אין תוצאות בספרייה.
        </p>
      ) : (
        <ul className="divide-y rounded-xl border">
          {results.map((person) => {
            const member = known.get(person.directoryId);

            return (
              <li
                key={person.directoryId}
                className={cn(
                  "flex items-center gap-3 px-3 py-3 sm:px-4",
                  member?.active && "opacity-55",
                )}
              >
                <PersonAvatar name={person.displayName} className="size-10" />

                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">
                    {person.displayName}
                  </p>
                  <p className="text-muted-foreground truncate text-xs">
                    {person.title}
                    {" · "}
                    <span dir="ltr" className="font-mono">
                      {person.username}
                    </span>
                  </p>
                </div>

                {member?.active ? (
                  <Badge variant="secondary" className="shrink-0 font-normal">
                    כבר בסבב
                  </Badge>
                ) : member ? (
                  // Same person, already on file. Restoring keeps the id their
                  // past themes point at; a second entry would strand them.
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => onRestore(member.id)}
                  >
                    החזרה לסבב
                  </Button>
                ) : (
                  <Button size="sm" onClick={() => onPick(person)}>
                    הוספה
                  </Button>
                )}
              </li>
            );
          })}
        </ul>
      )}

      <p className="text-muted-foreground text-xs text-balance">
        החיפוש רץ בחשבון השירות ולא מנסה להזדהות כאף אחד, ולכן אינו נוגע במונה
        הכניסות הכושלות של אף חשבון.
      </p>
    </div>
  );
}

function Confirm({
  person,
  rotationSize,
  onBack,
  onConfirm,
}: {
  person: DirectoryPerson;
  rotationSize: number;
  onBack: () => void;
  onConfirm: (gender: Member["gender"]) => void;
}) {
  const [gender, setGender] = useState<Member["gender"]>("f");

  return (
    <div className="min-w-0 space-y-5">
      <div className="bg-muted/40 flex items-center gap-3 rounded-xl border p-4">
        <PersonAvatar name={person.displayName} className="size-10" />
        <div className="min-w-0">
          <p className="truncate text-sm font-medium">{person.displayName}</p>
          <p className="text-muted-foreground truncate text-xs">
            {person.title}
            {" · "}
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
        <GenderChoice value={gender} onChange={setGender} className="w-full" />
        <p className="text-muted-foreground text-xs">
          כדי לכתוב &rlm;„{gender === "f" ? "מביאה" : "מביא"} את הכיבוד”.
        </p>
      </div>

      <p className="text-muted-foreground text-xs text-balance">
        {person.displayName} {gender === "f" ? "תיכנס" : "ייכנס"} לסוף הסבב, שבו
        יהיו מעכשיו {rotationSize + 1} אנשים — כך שהתור של כולם זז בשבוע.
      </p>

      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button type="button" variant="outline" size="lg" onClick={onBack}>
          חזרה
        </Button>
        <Button type="button" size="lg" onClick={() => onConfirm(gender)}>
          הוספה לסבב
        </Button>
      </div>
    </div>
  );
}

/** Two states, both always visible — a switch would not say what it toggles. */
function GenderChoice({
  value,
  onChange,
  className,
}: {
  value: Member["gender"];
  onChange: (gender: Member["gender"]) => void;
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
          {option === "f" ? "מביאה" : "מביא"}
        </button>
      ))}
    </div>
  );
}
