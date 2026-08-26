"use client";

import { useState } from "react";
import { PlusIcon, StarIcon } from "lucide-react";

import { PersonAvatar } from "@/components/person-avatar";
import { ReviewFormDialog } from "@/components/review-form-dialog";
import { Button } from "@/components/ui/button";
import { formatWeekRange, plural } from "@/lib/format";
import {
  averageRating,
  byWeek,
  memberById,
  type ShotefReview,
} from "@/lib/shotef-schema";
import { type Member } from "@/lib/team";
import { cn } from "@/lib/utils";

/** Whole stars only — a week is scored by feel, not to a decimal. */
const MAX_STARS = 5;

export function ShotefReviews({
  initial,
  roster,
  nowIso,
}: {
  initial: ShotefReview[];
  roster: Member[];
  /** "Now" is fixed by the server, so the week picker offers the same weeks. */
  nowIso: string;
}) {
  // Local only: a new summary lives in this tab until the section grows a
  // database. Nothing hands down a fresh `initial`, so there is no `seed`
  // reconcile here like the quote feed keeps.
  const [reviews, setReviews] = useState(initial);
  const [adding, setAdding] = useState(false);
  const average = averageRating(reviews);

  return (
    <div className="space-y-4">
      <section className="bg-card flex flex-wrap items-center justify-between gap-3 rounded-2xl border p-5 shadow-sm">
        <div>
          <p className="text-2xl font-bold tabular-nums">
            {average.toFixed(1)}
            <span className="text-muted-foreground text-base font-medium">
              {" "}
              מתוך {MAX_STARS}
            </span>
          </p>
          <p className="text-muted-foreground mt-1 text-sm">
            {plural(reviews.length, "שבוע אחד מסוכם", "שבועות מסוכמים")}
          </p>
        </div>
        {/* Rounded down deliberately: a 3.8 that shows four full stars claims a
            week nobody gave. */}
        <Stars rating={Math.floor(average)} className="size-5" />
      </section>

      <section className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-muted-foreground text-xs font-semibold">
            שבוע אחרי שבוע
          </h2>
          {/* Not gated on a session like the other sections' add buttons: this
              writes to React state and no further. It takes the gate when it
              takes an API. */}
          <Button size="sm" onClick={() => setAdding(true)} className="gap-1.5">
            <PlusIcon className="size-4" />
            סיכום חדש
          </Button>
        </div>

        {/* Sorted here rather than trusted from the fixtures: a summary can be
            written for any week that has closed, not only the latest one. */}
        {byWeek(reviews).map((review) => (
          <ReviewCard key={review.id} review={review} roster={roster} />
        ))}
      </section>

      {/* Mounted only while open, so each visit starts from an empty form. */}
      {adding ? (
        <ReviewFormDialog
          open
          onOpenChange={setAdding}
          onAdd={(review) => setReviews((current) => [review, ...current])}
          reviews={reviews}
          roster={roster}
          nowIso={nowIso}
        />
      ) : null}
    </div>
  );
}

function ReviewCard({
  review,
  roster,
}: {
  review: ShotefReview;
  roster: Member[];
}) {
  // A member who has left the roster keeps their week — the review is of the
  // week, and the name on it is the only identity it needs.
  const member = memberById(review.memberId, roster);
  const name = member?.name ?? "לא ידוע";

  return (
    <article className="bg-card rounded-2xl border p-5 shadow-sm">
      <header className="flex items-center gap-3">
        <PersonAvatar name={name} className="size-9 text-sm" />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium">{name}</p>
          <p className="text-muted-foreground truncate text-xs">
            {formatWeekRange(review.weekStart)}
          </p>
        </div>
        <Stars rating={review.rating} />
      </header>

      <h3 className="mt-3 leading-snug font-semibold text-balance">
        {review.headline}
      </h3>
      <p className="text-muted-foreground mt-2 text-sm leading-relaxed">
        {review.body}
      </p>
    </article>
  );
}

/**
 * The score as stars. One label on the group rather than five nested ones — a
 * screen reader should hear "4 מתוך 5", not four separate stars.
 */
function Stars({
  rating,
  className,
}: {
  rating: number;
  className?: string;
}) {
  return (
    <span
      className="flex shrink-0 items-center gap-0.5"
      role="img"
      aria-label={`${rating} מתוך ${MAX_STARS}`}
    >
      {Array.from({ length: MAX_STARS }, (_, index) => (
        <StarIcon
          key={index}
          aria-hidden
          className={cn(
            "size-4",
            index < rating
              ? "fill-primary text-primary"
              : "text-muted-foreground/35",
            className,
          )}
        />
      ))}
    </span>
  );
}
