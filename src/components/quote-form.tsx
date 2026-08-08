"use client";

import { useState, useSyncExternalStore } from "react";
import { Loader2Icon } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { todayInputValue, toInputValue } from "@/lib/format";
import type { Quote } from "@/lib/quote-schema";
import { cn } from "@/lib/utils";

const ADDED_BY_KEY = "zitutim:added-by";

interface Values {
  text: string;
  author: string;
  saidAt: string;
  context: string;
  /** null = untouched, so the remembered name shows through. */
  addedBy: string | null;
}

function emptyValues(): Values {
  return {
    text: "",
    author: "",
    saidAt: todayInputValue(),
    context: "",
    addedBy: null,
  };
}

function subscribeToStorage(onChange: () => void) {
  window.addEventListener("storage", onChange);
  return () => window.removeEventListener("storage", onChange);
}

/**
 * Reading localStorage throws outright when storage is blocked (Safari private
 * browsing, embedded contexts). Remembering a name is a nicety, so degrade to
 * "not remembered" rather than taking the whole form down with us.
 */
function readRememberedName(): string {
  try {
    return localStorage.getItem(ADDED_BY_KEY) ?? "";
  } catch {
    return "";
  }
}

function rememberName(name: string): void {
  try {
    localStorage.setItem(ADDED_BY_KEY, name);
  } catch {
    /* not worth surfacing — the quote itself saved fine */
  }
}

/**
 * Most people add quotes under the same name every time, so the last one is
 * remembered. Read through `useSyncExternalStore` rather than an effect: the
 * server snapshot is empty, and React reconciles the real value on hydration.
 */
function useRememberedName(): string {
  return useSyncExternalStore(subscribeToStorage, readRememberedName, () => "");
}

function valuesFrom(quote: Quote): Values {
  return {
    text: quote.text,
    author: quote.author,
    saidAt: toInputValue(quote.saidAt),
    context: quote.context ?? "",
    addedBy: quote.addedBy ?? "",
  };
}

export function QuoteForm({
  quote,
  onSuccess,
  onCancel,
  submitLabel,
  className,
}: {
  /** Present = edit mode; absent = create mode. */
  quote?: Quote;
  onSuccess?: (quote: Quote) => void;
  onCancel?: () => void;
  submitLabel?: string;
  className?: string;
}) {
  const [values, setValues] = useState<Values>(() =>
    quote ? valuesFrom(quote) : emptyValues(),
  );
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  const remembered = useRememberedName();
  const addedBy = values.addedBy ?? remembered;

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
    if (!values.text.trim()) local.text = "צריך לכתוב מה נאמר";
    if (!values.author.trim()) local.author = "צריך לציין מי אמר";
    if (!values.saidAt) local.saidAt = "צריך לבחור תאריך";
    if (Object.keys(local).length > 0) {
      setErrors(local);
      return;
    }

    setSaving(true);
    try {
      const response = await fetch(
        quote ? `/api/quotes/${quote.id}` : "/api/quotes",
        {
          method: quote ? "PUT" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ...values, addedBy }),
        },
      );

      const payload = await response.json().catch(() => null);

      if (!response.ok) {
        if (payload?.issues) setErrors(payload.issues);
        toast.error(payload?.error ?? "משהו השתבש");
        return;
      }

      if (addedBy.trim()) rememberName(addedBy.trim());

      toast.success(quote ? "הציטוט עודכן" : "הציטוט נוסף לקיר");
      if (!quote) setValues(emptyValues());
      onSuccess?.(payload as Quote);
    } catch {
      toast.error("אין חיבור לשרת");
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className={cn("space-y-5", className)}>
      <Field
        id="text"
        label="מה נאמר?"
        error={errors.text}
        hint={`${values.text.length}/2000`}
      >
        <Textarea
          id="text"
          value={values.text}
          onChange={(event) => set("text", event.target.value)}
          maxLength={2000}
          rows={4}
          placeholder="״תמיד יש זמן לעוד קפה אחד״"
          aria-invalid={Boolean(errors.text)}
          className="resize-y text-base leading-relaxed"
        />
      </Field>

      <div className="grid gap-5 sm:grid-cols-2">
        <Field id="author" label="מי אמר?" error={errors.author}>
          <Input
            id="author"
            value={values.author}
            onChange={(event) => set("author", event.target.value)}
            maxLength={120}
            placeholder="שם"
            autoComplete="off"
            aria-invalid={Boolean(errors.author)}
          />
        </Field>

        <Field id="saidAt" label="מתי?" error={errors.saidAt}>
          <Input
            id="saidAt"
            type="date"
            value={values.saidAt}
            max={todayInputValue()}
            onChange={(event) => set("saidAt", event.target.value)}
            aria-invalid={Boolean(errors.saidAt)}
            className="[&::-webkit-calendar-picker-indicator]:cursor-pointer"
          />
        </Field>
      </div>

      <Field
        id="context"
        label="הקשר"
        optional
        error={errors.context}
        hint="איפה זה קרה, מה הוביל לזה"
      >
        <Input
          id="context"
          value={values.context}
          onChange={(event) => set("context", event.target.value)}
          maxLength={400}
          placeholder="בסטנדאפ של יום שני, אחרי שהבילד נפל בפעם השלישית"
          autoComplete="off"
        />
      </Field>

      <Field id="addedBy" label="מי מוסיף?" optional error={errors.addedBy}>
        <Input
          id="addedBy"
          value={addedBy}
          onChange={(event) => set("addedBy", event.target.value)}
          maxLength={120}
          placeholder="השם שלך"
          autoComplete="off"
        />
      </Field>

      <div className="flex flex-col-reverse gap-2 pt-1 sm:flex-row sm:justify-end">
        {onCancel ? (
          <Button
            type="button"
            variant="outline"
            size="lg"
            onClick={onCancel}
            disabled={saving}
          >
            ביטול
          </Button>
        ) : null}
        <Button type="submit" size="lg" disabled={saving} className="gap-2">
          {saving ? <Loader2Icon className="size-4 animate-spin" /> : null}
          {submitLabel ?? (quote ? "שמירת שינויים" : "הוספה לקיר")}
        </Button>
      </div>
    </form>
  );
}

function Field({
  id,
  label,
  optional,
  hint,
  error,
  children,
}: {
  id: string;
  label: string;
  optional?: boolean;
  hint?: string;
  error?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-2">
      <div className="flex items-baseline justify-between gap-2">
        <Label htmlFor={id} className="text-sm font-semibold">
          {label}
          {optional ? (
            <span className="text-muted-foreground me-1 font-normal">
              {" "}
              (לא חובה)
            </span>
          ) : (
            <span className="text-primary" aria-hidden>
              {" "}
              *
            </span>
          )}
        </Label>
        {hint && !error ? (
          <span className="text-muted-foreground text-xs">{hint}</span>
        ) : null}
      </div>
      {children}
      {error ? (
        <p role="alert" className="text-destructive text-xs font-medium">
          {error}
        </p>
      ) : null}
    </div>
  );
}
