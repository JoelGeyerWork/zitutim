"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2Icon } from "lucide-react";
import { toast } from "sonner";

import { Field } from "@/components/field";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { todayInputValue, toInputValue } from "@/lib/format";
import type { Quote } from "@/lib/quote-schema";
import { cn } from "@/lib/utils";

// There is no `addedBy` field any more: attribution comes from the session, so
// asking the browser to remember a name would just be a way to get it wrong.
interface Values {
  text: string;
  author: string;
  saidAt: string;
  context: string;
}

function emptyValues(): Values {
  return {
    text: "",
    author: "",
    saidAt: todayInputValue(),
    context: "",
  };
}

function valuesFrom(quote: Quote): Values {
  return {
    text: quote.text,
    author: quote.author,
    saidAt: toInputValue(quote.saidAt),
    context: quote.context ?? "",
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
  const router = useRouter();

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
          body: JSON.stringify(values),
        },
      );

      const payload = await response.json().catch(() => null);

      // The session can lapse while the form is open, so send them somewhere
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
