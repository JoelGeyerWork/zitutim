"use client";

import { useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { SearchIcon } from "lucide-react";
import { toast } from "sonner";

import { DirectorySearch } from "@/components/directory-search";
import { Field } from "@/components/field";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { type DirectoryPerson } from "@/lib/directory-schema";
import { todayInputValue } from "@/lib/format";
import {
  directoryRef,
  personKey,
  userRef,
  type PersonRef,
} from "@/lib/person-ref";
import {
  AWARD_ICONS,
  AWARD_ICON_LABELS,
  monitorInputSchema,
  type AwardIcon,
  type SolvedMonitor,
} from "@/lib/shotef-schema";
import { type Member } from "@/lib/team";
import { cn } from "@/lib/utils";

/**
 * How long a fix took, as a number and a unit rather than a box asking for
 * minutes: nobody types 2160, and "יום וחצי" is how the answer is actually
 * held in someone's head.
 */
const UNITS = {
  minutes: { label: "דקות", minutes: 1 },
  hours: { label: "שעות", minutes: 60 },
  days: { label: "ימים", minutes: 60 * 24 },
} as const;

type Unit = keyof typeof UNITS;

/**
 * A name the certificate can carry, and the reference the server will resolve
 * it by.
 *
 * The rotation arrives as `users._id` rows and becomes `{ source: "user" }`
 * references — the path that needs no directory at all. Anyone found in the
 * search is appended as a `{ source: "directory" }` reference carrying the name
 * it returned, so their button reads properly before this app has ever heard of
 * them.
 */
type Candidate = { key: string; ref: PersonRef; name: string };

function fromRoster(member: Member): Candidate {
  const ref = userRef(member.id);
  return { key: personKey(ref), ref, name: member.name };
}

function fromDirectory(person: DirectoryPerson): Candidate {
  const ref = directoryRef(person.directoryId);
  return { key: personKey(ref), ref, name: person.displayName };
}

type Values = {
  monitor: string;
  icon: AwardIcon;
  solution: string;
  /** Candidate `key`s, in the order the certificate will name them. */
  solvedBy: string[];
  firstFiredAt: string;
  solvedAt: string;
  amount: string;
  unit: Unit;
};

function emptyValues(): Values {
  const today = todayInputValue();
  return {
    monitor: "",
    icon: "memory",
    solution: "",
    solvedBy: [],
    firstFiredAt: today,
    solvedAt: today,
    amount: "",
    unit: "hours",
  };
}

export function MonitorFormDialog({
  open,
  onOpenChange,
  onAdded,
  roster,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The record the server created, so the wall can show it before the refresh. */
  onAdded: (monitor: SolvedMonitor) => void;
  /**
   * The on-call rotation — the names offered without asking, because they are
   * the likely ones. Not the limit of who a certificate may credit: a page is
   * rarely silenced alone, and whoever knew the subsystem is often on another
   * team entirely. They are found through the directory search below the row.
   */
  roster: Member[];
}) {
  const router = useRouter();
  const pathname = usePathname();
  const loginHref = `/login?next=${encodeURIComponent(pathname)}`;
  const [values, setValues] = useState<Values>(emptyValues);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  // Everyone the directory has been asked about this visit. They join the
  // button row, so a directory pick is un-picked exactly like a rotation one.
  const [found, setFound] = useState<Candidate[]>([]);
  const [searching, setSearching] = useState(false);

  const candidates = [...roster.map(fromRoster), ...found];
  const byKey = new Map(candidates.map((entry) => [entry.key, entry]));

  function set<K extends keyof Values>(key: K, value: Values[K]) {
    setValues((current) => ({ ...current, [key]: value }));
    setErrors((current) => {
      if (!current[key]) return current;
      const next = { ...current };
      delete next[key];
      return next;
    });
  }

  function toggleSolver(key: string) {
    // Computed inside the updater rather than from `values`: two names picked
    // inside one task would otherwise read the same pre-click list and the
    // second would drop the first.
    setValues((current) => ({
      ...current,
      solvedBy: current.solvedBy.includes(key)
        ? current.solvedBy.filter((picked) => picked !== key)
        : [...current.solvedBy, key],
    }));
    setErrors((current) => {
      if (!current.solvedBy) return current;
      const next = { ...current };
      delete next.solvedBy;
      return next;
    });
  }

  /**
   * A directory result joins the button row, already picked. Appended rather
   * than held apart, so removing them is the same press as removing anybody
   * else and the order the certificate is written in stays one list.
   */
  function addFromDirectory(person: DirectoryPerson) {
    const candidate = fromDirectory(person);
    setFound((current) =>
      current.some((entry) => entry.key === candidate.key)
        ? current
        : [...current, candidate],
    );
    if (!values.solvedBy.includes(candidate.key)) toggleSolver(candidate.key);
  }

  /**
   * The two spans are one control on screen, so their error has to land on it.
   * Applied to the server's issues as well as the local ones: the route
   * re-validates with the same schema and keys its 422 the same way, and an
   * error rendered under a field the form does not draw is invisible.
   */
  function onAmount(issues: Record<string, string>): Record<string, string> {
    if (!issues.minutesToFix) return issues;
    return { ...issues, amount: issues.minutesToFix };
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (saving) return;

    const amount = Number(values.amount);
    const parsed = monitorInputSchema.safeParse({
      monitor: values.monitor,
      icon: values.icon,
      solution: values.solution,
      // Keys back into references. A key with no candidate cannot happen — the
      // row is drawn from the same list — but `flatMap` drops one rather than
      // sending an undefined the schema would report on the wrong field.
      solvedBy: values.solvedBy.flatMap((key) => {
        const candidate = byKey.get(key);
        return candidate ? [candidate.ref] : [];
      }),
      firstFiredAt: values.firstFiredAt,
      solvedAt: values.solvedAt,
      // NaN on an empty or non-numeric box, which the schema rejects with the
      // same message as any other bad number rather than silently sending 0.
      minutesToFix: values.amount.trim()
        ? Math.round(amount * UNITS[values.unit].minutes)
        : Number.NaN,
    });

    if (!parsed.success) {
      // Keyed by field name, the same shape the other forms render from a
      // server 422 — so this dialog needs no second error convention. Checked
      // here for responsiveness only; the route re-validates with this same
      // schema and its 422 is the authority.
      const issues: Record<string, string> = {};
      for (const issue of parsed.error.issues) {
        const key = String(issue.path[0] ?? "monitor");
        issues[key] ??= issue.message;
      }
      setErrors(onAmount(issues));
      return;
    }

    setSaving(true);
    try {
      const response = await fetch("/api/shotef/monitors", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(parsed.data),
      });

      const payload = await response.json().catch(() => null);

      // The session can lapse while the form is open, so send them somewhere
      // they can do something about it rather than just reporting failure.
      if (response.status === 401) {
        toast.error(payload?.error ?? "פג תוקף החיבור");
        router.push(loginHref);
        return;
      }

      if (!response.ok) {
        if (payload?.issues) setErrors(onAmount(payload.issues));
        toast.error(payload?.error ?? "לא הצלחנו לשמור את התעודה");
        return;
      }

      // Shown at once, then re-seeded by the refresh — see `HallOfFame`.
      onAdded(payload as SolvedMonitor);
      toast.success("התעודה נתלתה על הקיר");
      setValues(emptyValues());
      setFound([]);
      setSearching(false);
      router.refresh();
      onOpenChange(false);
    } catch {
      toast.error("אין חיבור לשרת");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>תעודה חדשה</DialogTitle>
          <DialogDescription>
            איזה מוניטור השתקתם, ואיך. נשמר לכולם, ונתלה על הקיר.
          </DialogDescription>
        </DialogHeader>

        {/* No empty-rotation branch any more: a certificate names whoever
            actually silenced the thing, and the directory search finds them
            whether or not anybody is on the wheel. */}
        <form onSubmit={handleSubmit} className="space-y-5">
            <Field
              id="monitor"
              label="שם המוניטור"
              hint="כמו שהוא כתוב במערכת ההתראות"
              error={errors.monitor}
            >
              <Input
                id="monitor"
                dir="ltr"
                value={values.monitor}
                onChange={(event) => set("monitor", event.target.value)}
                maxLength={120}
                placeholder="db-prod-01: RAM above 95%"
                autoComplete="off"
                className="font-mono"
                aria-invalid={Boolean(errors.monitor)}
              />
            </Field>

            <Field id="solution" label="איך פתרנו" error={errors.solution}>
              <Textarea
                id="solution"
                value={values.solution}
                onChange={(event) => set("solution", event.target.value)}
                maxLength={1200}
                rows={5}
                placeholder="מה באמת גרם לזה, ומה עשיתם כדי שזה לא יחזור"
                aria-invalid={Boolean(errors.solution)}
              />
            </Field>

            {/* Every name on the certificate. A page is rarely silenced alone. */}
            <Field
              id="solvers"
              label="מי פתר"
              hint={roster.length > 0 ? "הסבב, ומי שעוד היה שם" : undefined}
              error={errors.solvedBy}
            >
              <div id="solvers" className="space-y-3">
                {candidates.length > 0 ? (
                  <div className="flex flex-wrap gap-2">
                    {candidates.map((candidate) => {
                      const picked = values.solvedBy.includes(candidate.key);
                      return (
                        <Button
                          key={candidate.key}
                          type="button"
                          size="sm"
                          variant={picked ? "default" : "outline"}
                          aria-pressed={picked}
                          onClick={() => toggleSolver(candidate.key)}
                          className={cn(!picked && "text-muted-foreground")}
                        >
                          {candidate.name}
                        </Button>
                      );
                    })}
                  </div>
                ) : null}

                {searching ? (
                  <div className="space-y-3 rounded-xl border p-3 sm:p-4">
                    <DirectorySearch
                      autoFocus
                      loginHref={loginHref}
                      taken={(person) =>
                        values.solvedBy.includes(fromDirectory(person).key)
                      }
                      action={(person) =>
                        values.solvedBy.includes(fromDirectory(person).key) ? (
                          <Badge
                            variant="secondary"
                            className="shrink-0 font-normal"
                          >
                            כבר על התעודה
                          </Badge>
                        ) : (
                          <Button
                            size="sm"
                            type="button"
                            onClick={() => addFromDirectory(person)}
                          >
                            הוספה
                          </Button>
                        )
                      }
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => setSearching(false)}
                      className="w-full"
                    >
                      סגירת החיפוש
                    </Button>
                  </div>
                ) : (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => setSearching(true)}
                    className="text-muted-foreground gap-1.5 px-0"
                  >
                    <SearchIcon className="size-3.5" />
                    מי שעזר לא ברשימה? חיפוש בספריית הארגון
                  </Button>
                )}
              </div>
            </Field>

            <div className="grid gap-5 sm:grid-cols-2">
              <Field
                id="firstFiredAt"
                label="מתי התחיל לצעוק"
                error={errors.firstFiredAt}
              >
                <Input
                  id="firstFiredAt"
                  type="date"
                  value={values.firstFiredAt}
                  onChange={(event) => set("firstFiredAt", event.target.value)}
                  aria-invalid={Boolean(errors.firstFiredAt)}
                  className="[&::-webkit-calendar-picker-indicator]:cursor-pointer"
                />
              </Field>

              <Field id="solvedAt" label="מתי הושתק" error={errors.solvedAt}>
                <Input
                  id="solvedAt"
                  type="date"
                  value={values.solvedAt}
                  onChange={(event) => set("solvedAt", event.target.value)}
                  aria-invalid={Boolean(errors.solvedAt)}
                  className="[&::-webkit-calendar-picker-indicator]:cursor-pointer"
                />
              </Field>
            </div>

            <div className="grid gap-5 sm:grid-cols-2">
              <Field id="amount" label="כמה זמן לקח לתקן" error={errors.amount}>
                <div className="flex gap-2">
                  <Input
                    id="amount"
                    type="number"
                    inputMode="numeric"
                    min={1}
                    value={values.amount}
                    onChange={(event) => set("amount", event.target.value)}
                    placeholder="3"
                    aria-invalid={Boolean(errors.amount)}
                  />
                  <Select
                    value={values.unit}
                    onValueChange={(value) => set("unit", value as Unit)}
                  >
                    <SelectTrigger aria-label="יחידת זמן" className="w-28">
                      {/* Base UI renders the raw value unless told how to label it. */}
                      <SelectValue>
                        {(value: Unit) => UNITS[value].label}
                      </SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      {Object.entries(UNITS).map(([unit, { label }]) => (
                        <SelectItem key={unit} value={unit}>
                          {label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </Field>

              <Field id="icon" label="חותם" error={errors.icon}>
                <Select
                  value={values.icon}
                  onValueChange={(value) => set("icon", value as AwardIcon)}
                >
                  <SelectTrigger id="icon" className="w-full">
                    <SelectValue>
                      {(value: AwardIcon) => AWARD_ICON_LABELS[value]}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    {AWARD_ICONS.map((icon) => (
                      <SelectItem key={icon} value={icon}>
                        {AWARD_ICON_LABELS[icon]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
            </div>

            <div className="flex flex-col-reverse gap-2 pt-1 sm:flex-row sm:justify-end">
              <Button
                type="button"
                variant="outline"
                size="lg"
                onClick={() => onOpenChange(false)}
              >
                ביטול
              </Button>
              <Button type="submit" size="lg" disabled={saving}>
                {saving ? "שומר…" : "תליית התעודה"}
              </Button>
            </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
