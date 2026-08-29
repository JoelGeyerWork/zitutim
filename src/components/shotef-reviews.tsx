"use client";

import { useState } from "react";
import { ClipboardListIcon, PlusIcon, StarIcon } from "lucide-react";

import { PersonAvatar } from "@/components/person-avatar";
import { ReviewFormDialog } from "@/components/review-form-dialog";
import { Button } from "@/components/ui/button";
import { formatWeekRange, plural } from "@/lib/format";
import {
  averageRating,
  byWeek,
  type ShotefReview,
  type ShotefReviewList,
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
  initial: ShotefReviewList;
  /** The on-call rotation — who the add dialog may name. Not who past weeks
   *  belong to: a summary carries its own resolved name. */
  roster: Member[];
  /** "Now" is fixed by the server, so the week picker offers the same weeks. */
  nowIso: string;
}) {
  const [list, setList] = useState(initial);
  const [adding, setAdding] = useState(false);

  // The dialog posts and then `router.refresh()`, which re-runs the server page
  // and hands down a fresh `initial`. Reconciled during render, not in an
  // effect — `react-hooks/set-state-in-effect` is an error in this config.
  const [seed, setSeed] = useState(initial);
  if (seed !== initial) {
    setSeed(initial);
    setList(initial);
  }

  /**
   * The saved record, shown before the refresh behind it lands. Optimistic
   * rather than waiting on the round trip, and the totals move with it — a new
   * card above an unchanged average reads as a bug.
   */
  function added(review: ShotefReview) {
    setList((current) => {
      const reviews = [review, ...current.reviews];
      // Safe to recompute in the client only because the list is every review
      // there is; the moment it grows a `limit`, the server's `average` is the
      // only honest one.
      return { reviews, total: reviews.length, average: averageRating(reviews) };
    });
  }

  return (
    <div className="space-y-4">
      <section className="bg-card flex flex-wrap items-center justify-between gap-3 rounded-2xl border p-5 shadow-sm">
        <div>
          <p className="text-2xl font-bold tabular-nums">
            {list.average.toFixed(1)}
            <span className="text-muted-foreground text-base font-medium">
              {" "}
              מתוך {MAX_STARS}
            </span>
          </p>
          <p className="text-muted-foreground mt-1 text-sm">
            {plural(list.total, "שבוע אחד מסוכם", "שבועות מסוכמים")}
          </p>
        </div>
        {/* Rounded down deliberately: a 3.8 that shows four full stars claims a
            week nobody gave. */}
        <Stars rating={Math.floor(list.average)} className="size-5" />
      </section>

      <section className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-muted-foreground text-xs font-semibold">
            שבוע אחרי שבוע
          </h2>
          {/* Drawn for everyone, signed in or not. The POST answers 401 and
              the dialog sends them to the login page, which is the only way a
              signed-out reader learns that summarising a week is a thing they
              could do — hiding it leaves a populated page with no way in at
              all. Same choice the meetup editor makes. */}
          <Button size="sm" onClick={() => setAdding(true)} className="gap-1.5">
            <PlusIcon className="size-4" />
            סיכום חדש
          </Button>
        </div>

        {list.reviews.length === 0 ? (
          <div className="bg-card rounded-2xl border p-8 text-center shadow-sm">
            <ClipboardListIcon className="text-muted-foreground mx-auto size-8" />
            <p className="text-muted-foreground mt-3 text-sm text-balance">
              עדיין אין שבוע מסוכם.
            </p>
          </div>
        ) : (
          // Sorted here rather than trusted from the server: an optimistic card
          // is prepended, and a summary can be written for any closed week, not
          // only the latest one.
          byWeek(list.reviews).map((review) => (
            <ReviewCard key={review.id} review={review} />
          ))
        )}
      </section>

      {/* Mounted only while open, so each visit starts from an empty form. */}
      {adding ? (
        <ReviewFormDialog
          open
          onOpenChange={setAdding}
          onAdded={added}
          reviews={list.reviews}
          roster={roster}
          nowIso={nowIso}
        />
      ) : null}
    </div>
  );
}

function ReviewCard({ review }: { review: ShotefReview }) {
  // The name is resolved from `users` on the server, not looked up in the
  // current rotation: leaving the rotation must not blank out a week somebody
  // actually worked. Empty means the `users` row itself is gone, which it
  // never is.
  const name = review.memberName || "לא ידוע";

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
