import { StarIcon } from "lucide-react";

import { PersonAvatar } from "@/components/person-avatar";
import { Badge } from "@/components/ui/badge";
import { formatWeekRange, plural } from "@/lib/format";
import {
  averageRating,
  memberById,
  type ShotefReview,
} from "@/lib/shotef";
import { cn } from "@/lib/utils";

/** Whole stars only — a week is scored by feel, not to a decimal. */
const MAX_STARS = 5;

export function ShotefReviews({ reviews }: { reviews: ShotefReview[] }) {
  const average = averageRating(reviews);
  const issues = reviews.reduce((sum, review) => sum + review.issues, 0);

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
            {plural(reviews.length, "שבוע אחד מסוכם", "שבועות מסוכמים")} ·{" "}
            {plural(issues, "פנייה אחת", "פניות")} בסך הכול
          </p>
        </div>
        {/* Rounded down deliberately: a 3.8 that shows four full stars claims a
            week nobody gave. */}
        <Stars rating={Math.floor(average)} className="size-5" />
      </section>

      <section className="space-y-3">
        <h2 className="text-muted-foreground text-xs font-semibold">
          שבוע אחרי שבוע
        </h2>
        {reviews.map((review) => (
          <ReviewCard key={review.id} review={review} />
        ))}
      </section>
    </div>
  );
}

function ReviewCard({ review }: { review: ShotefReview }) {
  // A member who has left the roster keeps their week — the review is of the
  // week, and the name on it is the only identity it needs.
  const member = memberById(review.memberId);
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

      <footer className="mt-4 flex flex-wrap items-center justify-between gap-2 border-t pt-3">
        <Badge variant="outline" className="font-normal">
          {plural(review.issues, "פנייה אחת", "פניות")} בשבוע
        </Badge>
        <span className="text-muted-foreground text-xs">
          סוכם על ידי {review.reviewedBy}
        </span>
      </footer>
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
