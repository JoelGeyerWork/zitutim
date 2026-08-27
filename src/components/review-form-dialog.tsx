"use client";

import { useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { StarIcon } from "lucide-react";
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
import { formatWeekRange } from "@/lib/format";
import {
  RATING_LABELS,
  closedWeeks,
  reviewInputSchema,
  shotefOn,
  type ShotefReview,
} from "@/lib/shotef-schema";
import { type Member } from "@/lib/team";
import { cn } from "@/lib/utils";

/** How far back the picker offers. Older than this and nobody remembers. */
const WEEKS_OFFERED = 12;

const MAX_STARS = 5;

/** The week is taken. Rendered on that field, since that is what to change. */
const WEEK_TAKEN = "כבר יש סיכום לשבוע הזה";

type Values = {
  weekStart: string;
  memberId: string;
  rating: number;
  headline: string;
  body: string;
};

export function ReviewFormDialog({
  open,
  onOpenChange,
  onAdded,
  reviews,
  roster,
  nowIso,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The record the server created, so the list can show it before the refresh. */
  onAdded: (review: ShotefReview) => void;
  /** What is already written, so the same week isn't offered twice. */
  reviews: ShotefReview[];
  /** The on-call rotation: who may be named as this week's shotef. */
  roster: Member[];
  nowIso: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  // A week gets one summary. Dropping the taken ones from the list is the whole
  // duplicate check — there is no id to collide on and nothing to reject.
  const taken = new Set(reviews.map((review) => review.weekStart.slice(0, 10)));
  const weeks = closedWeeks(new Date(nowIso), WEEKS_OFFERED)
    .map((iso) => iso.slice(0, 10))
    .filter((week) => !taken.has(week));

  const [values, setValues] = useState<Values>(() => {
    const weekStart = weeks[0] ?? "";
    return {
      weekStart,
      memberId: shotefOn(weekStart, roster)?.id ?? "",
      rating: MAX_STARS,
      headline: "",
      body: "",
    };
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  // The week the form holds can stop being on offer underneath it: a 409 means
  // somebody else filed this week, and the `router.refresh()` behind that error
  // hands `reviews` down with their summary in it. Without this the trigger
  // goes on showing a week that is no longer in its own dropdown and every
  // resubmit repeats the 409. Reconciled during render like the parent's
  // `seed` comparison — `react-hooks/set-state-in-effect` is an error here.
  if (values.weekStart && !weeks.includes(values.weekStart)) {
    const weekStart = weeks[0] ?? "";
    setValues((current) => ({
      ...current,
      weekStart,
      memberId: shotefOn(weekStart, roster)?.id ?? current.memberId,
    }));
  }

  function set<K extends keyof Values>(key: K, value: Values[K]) {
    setValues((current) => ({ ...current, [key]: value }));
    clearError(key);
  }

  function clearError(key: keyof Values) {
    setErrors((current) => {
      if (!current[key]) return current;
      const next = { ...current };
      delete next[key];
      return next;
    });
  }

  /**
   * A star sets that score, except the star that already *is* the score, which
   * steps down — that is the only way to reach zero. Decided inside the updater
   * rather than from `values`, so two clicks landing in one task don't both
   * read the same pre-click score.
   */
  function pickRating(value: number) {
    setValues((current) => ({
      ...current,
      rating: current.rating === value ? value - 1 : value,
    }));
    clearError("rating");
  }

  /**
   * Picking a week re-answers who was on duty, because the rotation already
   * knows. Leaving a previous pick standing would quietly credit the wrong
   * person for a week they weren't on; an actual swap is re-picked by hand.
   */
  function pickWeek(weekStart: string) {
    setValues((current) => ({
      ...current,
      weekStart,
      memberId: shotefOn(weekStart, roster)?.id ?? current.memberId,
    }));
    clearError("weekStart");
    clearError("memberId");
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (saving) return;

    // Checked here for responsiveness only — the route re-validates with this
    // same schema and its 422 is the authority.
    const parsed = reviewInputSchema.safeParse(values);

    if (!parsed.success) {
      // Keyed by field name, the same shape the other forms render from a
      // server 422.
      const issues: Record<string, string> = {};
      for (const issue of parsed.error.issues) {
        const key = String(issue.path[0] ?? "headline");
        issues[key] ??= issue.message;
      }
      setErrors(issues);
      return;
    }

    setSaving(true);
    try {
      const response = await fetch("/api/shotef/reviews", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(parsed.data),
      });

      const payload = await response.json().catch(() => null);

      // The session can lapse while the form is open, so send them somewhere
      // they can do something about it rather than just reporting failure.
      if (response.status === 401) {
        toast.error(payload?.error ?? "פג תוקף החיבור");
        router.push(`/login?next=${encodeURIComponent(pathname)}`);
        return;
      }

      // Reachable even though the picker hides taken weeks: somebody else may
      // have filed this one since the page was loaded. Refresh behind it, so
      // the week drops out of the picker and their summary appears.
      if (response.status === 409) {
        setErrors({ weekStart: payload?.error ?? WEEK_TAKEN });
        toast.error(payload?.error ?? WEEK_TAKEN);
        router.refresh();
        return;
      }

      if (!response.ok) {
        if (payload?.issues) setErrors(payload.issues);
        toast.error(payload?.error ?? "לא הצלחנו לשמור את הסיכום");
        return;
      }

      // Shown at once, then re-seeded by the refresh — see `ShotefReviews`.
      onAdded(payload as ShotefReview);
      toast.success("השבוע סוכם");
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
          <DialogTitle>סיכום שבוע</DialogTitle>
          <DialogDescription>
            איך עבר השבוע של השוטף. נשמר לכולם, סיכום אחד לכל שבוע.
          </DialogDescription>
        </DialogHeader>

        {roster.length === 0 ? (
          <p className="text-muted-foreground py-4 text-sm text-balance">
            אין אף אחד בתורנות, אז אין למי לייחס את השבוע. מוסיפים אנשים בעמוד
            התורנות, ואז חוזרים לכאן.
          </p>
        ) : weeks.length === 0 ? (
          <p className="text-muted-foreground py-4 text-sm text-balance">
            כל השבועות האחרונים כבר מסוכמים. השבוע שרץ עכשיו יהיה זמין לסיכום
            ביום ראשון, כשהתורנות תעבור.
          </p>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-5">
            <div className="grid gap-5 sm:grid-cols-2">
              <Field id="weekStart" label="איזה שבוע" error={errors.weekStart}>
                <Select
                  value={values.weekStart}
                  // Base UI types the value as nullable; neither select is clearable.
                  onValueChange={(value) => pickWeek(value ?? "")}
                >
                  <SelectTrigger id="weekStart" className="w-full">
                    {/* Base UI renders the raw value unless told how to label it. */}
                    <SelectValue>
                      {(value: string) =>
                        value ? formatWeekRange(value) : "בחרו שבוע"
                      }
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    {weeks.map((week) => (
                      <SelectItem key={week} value={week}>
                        {formatWeekRange(week)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>

              <Field
                id="memberId"
                label="מי היה השוטף"
                hint="ממולא לפי הסבב"
                error={errors.memberId}
              >
                <Select
                  value={values.memberId}
                  onValueChange={(value) => set("memberId", value ?? "")}
                >
                  <SelectTrigger id="memberId" className="w-full">
                    <SelectValue>
                      {(value: string) =>
                        roster.find((member) => member.id === value)?.name ??
                        "בחרו אדם"
                      }
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    {roster.map((member) => (
                      <SelectItem key={member.id} value={member.id}>
                        {member.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
            </div>

            <Field
              id="rating"
              label="ציון"
              hint={RATING_LABELS[values.rating]}
              error={errors.rating}
            >
              <RatingPicker rating={values.rating} onPick={pickRating} />
            </Field>

            <Field
              id="headline"
              label="כותרת"
              hint="איך זוכרים את השבוע הזה"
              error={errors.headline}
            >
              <Input
                id="headline"
                value={values.headline}
                onChange={(event) => set("headline", event.target.value)}
                maxLength={80}
                placeholder="שבוע שקט שנגמר בשדרוג"
                autoComplete="off"
                aria-invalid={Boolean(errors.headline)}
              />
            </Field>

            <Field id="body" label="מה קרה" error={errors.body}>
              <Textarea
                id="body"
                value={values.body}
                onChange={(event) => set("body", event.target.value)}
                maxLength={800}
                rows={5}
                placeholder="מה נפל השבוע, מה נסגר, ומה נשאר פתוח לשבוע הבא"
                aria-invalid={Boolean(errors.body)}
              />
            </Field>

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
                {saving ? "שומר…" : "פרסום הסיכום"}
              </Button>
            </div>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}

/**
 * Whole stars. Each one is a button rather than a radio because the value it
 * reports is "this many", not "this one" — and it only reports the star that
 * was pressed; what that does to the score is the form's decision.
 */
function RatingPicker({
  rating,
  onPick,
}: {
  rating: number;
  onPick: (value: number) => void;
}) {
  return (
    <div id="rating" className="flex items-center gap-1">
      {Array.from({ length: MAX_STARS }, (_, index) => {
        const value = index + 1;
        const lit = value <= rating;

        return (
          <button
            key={value}
            type="button"
            aria-label={`${value} מתוך ${MAX_STARS}`}
            aria-pressed={lit}
            onClick={() => onPick(value)}
            className="focus-visible:ring-ring/50 rounded-sm p-0.5 focus-visible:ring-2 focus-visible:outline-none"
          >
            <StarIcon
              className={cn(
                "size-7 transition-colors",
                lit
                  ? "fill-primary text-primary"
                  : "text-muted-foreground/35 hover:text-muted-foreground/60",
              )}
            />
          </button>
        );
      })}
    </div>
  );
}
