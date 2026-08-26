"use client";

import { useState } from "react";
import { toast } from "sonner";

import { Field } from "@/components/field";
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
import { todayInputValue } from "@/lib/format";
import {
  AWARD_ICONS,
  AWARD_ICON_LABELS,
  monitorInputSchema,
  newMonitor,
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

type Values = {
  monitor: string;
  icon: AwardIcon;
  solution: string;
  solvedByIds: string[];
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
    solvedByIds: [],
    firstFiredAt: today,
    solvedAt: today,
    amount: "",
    unit: "hours",
  };
}

export function MonitorFormDialog({
  open,
  onOpenChange,
  onAdd,
  roster,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Local only: the wall holds the new plaque, nothing is posted anywhere. */
  onAdd: (monitor: SolvedMonitor) => void;
  roster: Member[];
}) {
  const [values, setValues] = useState<Values>(emptyValues);
  const [errors, setErrors] = useState<Record<string, string>>({});

  function set<K extends keyof Values>(key: K, value: Values[K]) {
    setValues((current) => ({ ...current, [key]: value }));
    setErrors((current) => {
      if (!current[key]) return current;
      const next = { ...current };
      delete next[key];
      return next;
    });
  }

  function toggleSolver(id: string) {
    // Computed inside the updater rather than from `values`: two names picked
    // inside one task would otherwise read the same pre-click list and the
    // second would drop the first.
    setValues((current) => ({
      ...current,
      solvedByIds: current.solvedByIds.includes(id)
        ? current.solvedByIds.filter((picked) => picked !== id)
        : [...current.solvedByIds, id],
    }));
    setErrors((current) => {
      if (!current.solvedByIds) return current;
      const next = { ...current };
      delete next.solvedByIds;
      return next;
    });
  }

  function handleSubmit(event: React.FormEvent) {
    event.preventDefault();

    const amount = Number(values.amount);
    const parsed = monitorInputSchema.safeParse({
      monitor: values.monitor,
      icon: values.icon,
      solution: values.solution,
      solvedByIds: values.solvedByIds,
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
      // server 422 — so this dialog needs no second error convention.
      const issues: Record<string, string> = {};
      for (const issue of parsed.error.issues) {
        const key = String(issue.path[0] ?? "monitor");
        issues[key] ??= issue.message;
      }
      // The two spans are one control here, so their error has to land on it.
      if (issues.minutesToFix) issues.amount = issues.minutesToFix;
      setErrors(issues);
      return;
    }

    onAdd(newMonitor(parsed.data));
    toast.success("התעודה נתלתה על הקיר");
    setValues(emptyValues());
    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>תעודה חדשה</DialogTitle>
          <DialogDescription>
            איזה מוניטור השתקתם, ואיך. נשמר רק בדפדפן הזה, עד שיהיה לזה מסד
            נתונים.
          </DialogDescription>
        </DialogHeader>

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
          <Field id="solvers" label="מי פתר" error={errors.solvedByIds}>
            <div id="solvers" className="flex flex-wrap gap-2">
              {roster.map((member) => {
                const picked = values.solvedByIds.includes(member.id);
                return (
                  <Button
                    key={member.id}
                    type="button"
                    size="sm"
                    variant={picked ? "default" : "outline"}
                    aria-pressed={picked}
                    onClick={() => toggleSolver(member.id)}
                    className={cn(!picked && "text-muted-foreground")}
                  >
                    {member.name}
                  </Button>
                );
              })}
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
            <Button type="submit" size="lg">
              תליית התעודה
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
