import { authorTone, initial } from "@/lib/format";
import { cn } from "@/lib/utils";

/**
 * The tints a person's initial can take, picked deterministically by name so
 * the same face looks the same on a quote card, in the account menu and in the
 * meetup rotation. Every tone is red or neutral — the palette has no other hue.
 */
export const TONES = [
  "bg-primary/10 text-primary",
  "bg-foreground/10 text-foreground",
  "bg-primary/20 text-primary",
  "bg-foreground/[0.06] text-muted-foreground",
  "bg-primary/[0.07] text-primary",
] as const;

export function toneFor(name: string): string {
  return TONES[authorTone(name)];
}

/** Initial-in-a-circle. Decorative — the name is always rendered beside it. */
export function PersonAvatar({
  name,
  className,
}: {
  name: string;
  className?: string;
}) {
  return (
    <span
      aria-hidden
      className={cn(
        "flex size-10 shrink-0 items-center justify-center rounded-full font-bold",
        toneFor(name),
        className,
      )}
    >
      {initial(name)}
    </span>
  );
}
