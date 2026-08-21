"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2Icon } from "lucide-react";
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
import { toInputValue } from "@/lib/format";
import { lastMeetup } from "@/lib/team";
import type { Theme, ThemeMember } from "@/lib/theme-schema";

/** The "nobody worked it out" option needs a value a <Select> can hold. */
const UNSOLVED = "none";

type Values = {
  date: string;
  broughtById: string;
  theme: string;
  snacks: string;
  guessedById: string;
};

function emptyValues(now: Date, broughtById: string): Values {
  return {
    date: toInputValue(lastMeetup(now).toISOString()),
    broughtById,
    theme: "",
    snacks: "",
    guessedById: UNSOLVED,
  };
}

export function ThemeFormDialog({
  open,
  onOpenChange,
  onSuccess,
  members,
  nowIso,
  defaultBroughtById,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess: (theme: Theme) => void;
  members: ThemeMember[];
  nowIso: string;
  /** Whoever the rotation says brought the last one — right most of the time. */
  defaultBroughtById: string;
}) {
  const [values, setValues] = useState<Values>(() =>
    emptyValues(new Date(nowIso), defaultBroughtById),
  );
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const router = useRouter();

  const nameById = (id: string) =>
    members.find((member) => member.id === id)?.name ?? id;

  function set<K extends keyof Values>(key: K, value: Values[K]) {
    setValues((current) => ({ ...current, [key]: value }));
    setErrors((current) => {
      if (!current[key]) return current;
      const next = { ...current };
      delete next[key];
      return next;
    });
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (saving) return;

    const local: Record<string, string> = {};
    if (!values.theme.trim()) local.theme = "צריך לכתוב מה היה הנושא";
    if (!values.date) local.date = "צריך לבחור תאריך";
    if (!values.broughtById) local.broughtById = "צריך לבחור מי הביא";
    if (Object.keys(local).length > 0) {
      setErrors(local);
      return;
    }

    setSaving(true);
    try {
      const response = await fetch("/api/themes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          date: values.date,
          broughtById: values.broughtById,
          theme: values.theme.trim(),
          // The comma-separated field is split here; the server drops empties.
          snacks: values.snacks
            .split(",")
            .map((snack) => snack.trim())
            .filter(Boolean),
          guessedById:
            values.guessedById === UNSOLVED ? null : values.guessedById,
        }),
      });

      const payload = await response.json().catch(() => null);

      // The session can lapse while the dialog is open, so send them somewhere
      // they can do something about it rather than just reporting failure.
      if (response.status === 401) {
        toast.error(payload?.error ?? "פג תוקף החיבור");
        router.push(
          `/login?next=${encodeURIComponent(window.location.pathname)}`,
        );
        return;
      }

      if (!response.ok) {
        if (payload?.issues) setErrors(payload.issues);
        toast.error(payload?.error ?? "משהו השתבש");
        return;
      }

      toast.success("הנושא נוסף");
      setValues(emptyValues(new Date(nowIso), defaultBroughtById));
      onSuccess(payload as Theme);
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
          <DialogTitle>נושא חדש</DialogTitle>
          <DialogDescription>
            מה היה על השולחן, ומי פיצח את זה.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-5">
          <Field id="theme" label="מה היה הנושא?" error={errors.theme}>
            <Input
              id="theme"
              value={values.theme}
              onChange={(event) => set("theme", event.target.value)}
              maxLength={120}
              placeholder="הכול מתחיל באות ב׳"
              autoComplete="off"
              aria-invalid={Boolean(errors.theme)}
            />
          </Field>

          <Field
            id="snacks"
            label="מה היה בכיבוד"
            optional
            hint="מופרד בפסיקים"
            error={errors.snacks}
          >
            <Input
              id="snacks"
              value={values.snacks}
              onChange={(event) => set("snacks", event.target.value)}
              maxLength={300}
              placeholder="בורקס, בננות, בייגל"
              autoComplete="off"
              aria-invalid={Boolean(errors.snacks)}
            />
          </Field>

          <div className="grid gap-5 sm:grid-cols-2">
            <Field id="date" label="מתי" error={errors.date}>
              <Input
                id="date"
                type="date"
                value={values.date}
                onChange={(event) => set("date", event.target.value)}
                aria-invalid={Boolean(errors.date)}
                className="[&::-webkit-calendar-picker-indicator]:cursor-pointer"
              />
            </Field>

            <Field id="broughtBy" label="מי הביא" error={errors.broughtById}>
              <Select
                value={values.broughtById}
                onValueChange={(value) => set("broughtById", String(value))}
              >
                <SelectTrigger id="broughtBy" className="w-full">
                  {/* Base UI renders the raw value unless told how to label it. */}
                  <SelectValue>
                    {(value: string) => nameById(value)}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {members.map((member) => (
                    <SelectItem key={member.id} value={member.id}>
                      {member.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          </div>

          <Field id="guessedBy" label="מי ניחש" optional>
            <Select
              value={values.guessedById}
              onValueChange={(value) => set("guessedById", String(value))}
            >
              <SelectTrigger id="guessedBy" className="w-full">
                <SelectValue>
                  {(value: string) =>
                    value === UNSOLVED ? "אף אחד לא ניחש" : nameById(value)
                  }
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={UNSOLVED}>אף אחד לא ניחש</SelectItem>
                {members.map((member) => (
                  <SelectItem key={member.id} value={member.id}>
                    {member.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>

          <div className="flex flex-col-reverse gap-2 pt-1 sm:flex-row sm:justify-end">
            <Button
              type="button"
              variant="outline"
              size="lg"
              onClick={() => onOpenChange(false)}
              disabled={saving}
            >
              ביטול
            </Button>
            <Button type="submit" size="lg" disabled={saving} className="gap-2">
              {saving ? <Loader2Icon className="size-4 animate-spin" /> : null}
              הוספת הנושא
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
