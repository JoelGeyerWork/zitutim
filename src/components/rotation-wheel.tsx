"use client";

import { CoffeeIcon, type LucideIcon } from "lucide-react";

import type { Member } from "@/lib/team";
import { cn } from "@/lib/utils";

/**
 * The wheel both weekly rotations spin — the ישב״צ refreshments and the שוטף.
 * It knows nothing about either: it is handed the faces, the angle and whether
 * it is mid-spin, and the only thing that says which rotation this is, is the
 * icon at the hub.
 */

const SIZE = 200;
const C = SIZE / 2;
const R = 94;
/** Where a name sits along its slice, as a fraction of the radius. */
const LABEL_R = 0.56;

/** A point on the rim, by angle in degrees clockwise from twelve o'clock. */
function polar(angle: number, radius: number): [number, number] {
  const rad = ((angle - 90) * Math.PI) / 180;
  return [C + radius * Math.cos(rad), C + radius * Math.sin(rad)];
}

/**
 * Slice `i` is *centred* on `i * slice` rather than starting there, so segment
 * zero sits under the pointer at rotation zero and the landing angle for a
 * winner is just `-winner * slice`.
 */
export function sliceAngle(count: number): number {
  return 360 / count;
}

/**
 * Two tones alternating leaves the first and last slice the same colour when
 * the rotation holds an odd number of people — and since the rotation is
 * editable, odd is not an edge case. The slice that closes the circle takes a
 * third, neutral tone instead of sitting against its own colour.
 */
function toneOf(index: number, count: number): "red" | "ground" | "seam" {
  if (count > 2 && count % 2 === 1 && index === count - 1) return "seam";
  return index % 2 === 0 ? "red" : "ground";
}

const FILL = {
  // The off slices take the page's own ground — white in light, black in dark
  // — so the wheel never inverts against the scheme around it. That leaves
  // them nearly the colour of the card they sit on, which is what the rim and
  // the separators are for.
  red: "var(--primary)",
  ground: "var(--background)",
  seam: "var(--muted)",
} as const;

const INK = {
  red: "var(--primary-foreground)",
  ground: "var(--foreground)",
  seam: "var(--foreground)",
} as const;

export function RotationWheel({
  members,
  rotation,
  durationMs,
  spinning,
  icon: HubIcon = CoffeeIcon,
}: {
  /** Fixed for the life of the wheel — a wheel's faces don't move, it turns. */
  members: Member[];
  /** Cumulative degrees. Only ever increases, so the wheel never rewinds. */
  rotation: number;
  durationMs: number;
  spinning: boolean;
  /** What sits at the hub, and the only thing naming the rotation. */
  icon?: LucideIcon;
}) {
  const slice = sliceAngle(members.length);

  return (
    <div className="relative mx-auto aspect-square w-full max-w-[320px]">
      {/* Sits under the wheel and does not turn with it, so the drop shadow
          stays lit from one direction instead of orbiting during a spin. */}
      <div
        aria-hidden
        className="bg-card absolute inset-[3%] rounded-full shadow-md"
      />

      <svg
        viewBox={`0 0 ${SIZE} ${SIZE}`}
        className="size-full transition-transform ease-[cubic-bezier(0.16,0.84,0.28,1)]"
        style={{
          transform: `rotate(${rotation}deg)`,
          transitionDuration: `${durationMs}ms`,
        }}
        aria-hidden
      >
        {members.map((member, index) => {
          const centre = index * slice;
          const [x0, y0] = polar(centre - slice / 2, R);
          const [x1, y1] = polar(centre + slice / 2, R);

          // Text drawn past the halfway point of the circle would come out
          // upside down; flipping it about its own centre keeps it in place.
          const upright = ((centre % 360) + 360) % 360 <= 180;
          const labelX = C + R * LABEL_R;
          const tone = toneOf(index, members.length);
          // A rotation of one is legal (and editable down to it), but
          // `sliceAngle(1)` is 360°, which makes the arc endpoints identical and
          // collapses the slice to a fill-less line. The lone member fills the
          // whole disc instead.
          const single = members.length === 1;

          return (
            <g key={member.id}>
              {single ? (
                <circle
                  cx={C}
                  cy={C}
                  r={R}
                  fill={FILL[tone]}
                  stroke="var(--border)"
                  strokeWidth="0.5"
                />
              ) : (
                <path
                  d={`M ${C} ${C} L ${x0} ${y0} A ${R} ${R} 0 ${
                    slice > 180 ? 1 : 0
                  } 1 ${x1} ${y1} Z`}
                  fill={FILL[tone]}
                  stroke="var(--border)"
                  strokeWidth="0.5"
                />
              )}

              <g transform={`rotate(${centre - 90} ${C} ${C})`}>
                <text
                  x={labelX}
                  y={C}
                  transform={
                    upright ? undefined : `rotate(180 ${labelX} ${C})`
                  }
                  textAnchor="middle"
                  dominantBaseline="central"
                  className="text-[9px] font-semibold"
                  fill={INK[tone]}
                >
                  {member.name.split(" ")[0]}
                </text>
              </g>
            </g>
          );
        })}

        {/* Just enough rim to close the circle where a slice matches the card
            behind it — the shadow under the wheel does the rest of the work. */}
        <circle
          cx={C}
          cy={C}
          r={R}
          fill="none"
          stroke="var(--border)"
          strokeWidth="1"
        />
      </svg>

      {/* The pointer and the hub stay put while the wheel turns under them. */}
      <div className="pointer-events-none absolute inset-x-0 -top-1 flex justify-center">
        <svg viewBox="0 0 20 18" className="text-primary size-5 drop-shadow-sm">
          <path d="M10 18 L0 0 L20 0 Z" fill="currentColor" />
        </svg>
      </div>

      <div
        className={cn(
          "bg-card ring-primary/30 pointer-events-none absolute inset-0 m-auto flex size-12 items-center justify-center rounded-full shadow-sm ring-4 transition-transform",
          spinning && "scale-90",
        )}
      >
        <HubIcon className="text-primary size-5" />
      </div>
    </div>
  );
}
