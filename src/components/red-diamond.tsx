/**
 * The hub's gem: the card suit the wordmark uses, as a solid — an octahedron,
 * four faces above the waist and four below, mirrored, turning on the spot.
 *
 * No canvas, no WebGL, no library: nothing extra to ship onto an air-gapped
 * network, and nothing to hydrate either. Every moving part is a keyframe, so
 * this stays a server component.
 *
 * Colour comes from `--primary` alone, mixed toward white and black, so the
 * stone follows the red/white/black palette into both schemes without a
 * literal colour anywhere.
 */

/**
 * Faces around the waist. Four, so the solid is an octahedron: eight faces, and
 * a silhouette that is the ♦ itself from any angle.
 *
 * It is also why the stone visibly breathes as it turns — a square seen from
 * the side is its full width across a corner and 71% of it across a flat, four
 * times a revolution. That pulse is the shape being honest about having corners;
 * smoothing it out means more faces, which is a different, rounder object.
 */
const FACES = 4;

const HALF_ANGLE = Math.PI / FACES; // half the azimuth one face spans
const SIN = Math.sin(HALF_ANGLE);
const COS = Math.cos(HALF_ANGLE);
const DEG = 180 / Math.PI;

/**
 * How tall the stone is, in half-widths. The card suit is appreciably taller
 * than it is wide — at 1:1 this reads as a spinning box, not a diamond.
 */
const HALF_HEIGHT = 1.6;

/** The profile, turned about the vertical axis: apex, waist, apex. */
const PROFILE = [
  { r: 0, y: -HALF_HEIGHT },
  { r: 1, y: 0 },
  { r: 0, y: HALF_HEIGHT },
];

/**
 * Lengths are `calc()` off one custom property rather than pixels computed
 * here, so the stone is fluid: the caller sets `--gem` (the width across the
 * waist) and the whole solid follows, with no breakpoint in the geometry. The
 * profile is in half-widths, hence the halving.
 */
const len = (halfWidths: number) => `calc(var(--gem) * ${(halfWidths / 2).toFixed(5)})`;

/**
 * One ring of faces, between two profile vertices.
 *
 * A face is hinged on whichever of its two edges stands further from the axis —
 * here always the waist, since the other end is a point. `rotateY` swings it to
 * its azimuth, `translateZ` pushes it out to the waist edge, and `rotateX` leans
 * it until its far edge lands exactly on the other vertex's radius. That last
 * constraint is what fixes both the tilt and the slant height, rather than
 * either being eyeballed:
 *
 *     slant · sin(tilt) = the horizontal run     slant · cos(tilt) = the rise
 *
 * A vertex with no radius needs no special case: its edge simply has no width,
 * and the trapezoid clips itself into the triangle an apex wants.
 */
function ring(top: (typeof PROFILE)[number], bottom: (typeof PROFILE)[number]) {
  const topApothem = top.r * COS;
  const bottomApothem = bottom.r * COS;
  const rise = bottom.y - top.y;
  const run = Math.abs(topApothem - bottomApothem);

  // Which edge is the outer one, and therefore the hinge.
  const hangs = topApothem >= bottomApothem;

  const widths = [2 * top.r * SIN, 2 * bottom.r * SIN];
  const width = Math.max(...widths);
  const inset = ((width - Math.min(...widths)) / 2 / width) * 100;
  const far = (100 - inset).toFixed(3);

  return {
    width,
    hangs,
    slant: Math.hypot(run, rise),
    apothem: hangs ? topApothem : bottomApothem,
    hinge: hangs ? top.y : bottom.y,
    tilt: (hangs ? -1 : 1) * Math.atan2(run, rise) * DEG,
    clip: hangs
      ? `polygon(0 0, 100% 0, ${far}% 100%, ${inset.toFixed(3)}% 100%)`
      : `polygon(${inset.toFixed(3)}% 0, ${far}% 0, 100% 100%, 0 100%)`,
  };
}

/**
 * How each half is painted, waist first. The shape is mirrored but the light is
 * not: the crown catches it and the pavilion is where the stone gets its depth,
 * so it runs very dark — a red that is bright everywhere reads as pink plastic.
 *
 * `alpha` is a little translucency, so the far side of the stone shows through
 * the near side and it reads as a solid rather than as a paper cut-out. It is
 * baked into the paint rather than set as `opacity` on the face: `opacity < 1`
 * is a grouping property, which hands each face its own stacking context, and
 * some engines then paint those in DOM order rather than by depth — a back
 * face drawn over a front one is the one thing that gives a CSS solid away.
 */
const HALVES = [
  { name: "crown", light: 52, dark: -34, alpha: 0.95 },
  { name: "pavilion", light: 2, dark: -72, alpha: 0.88 },
];

/** A signed mix: positive tints toward white, negative shades toward black. */
const mix = (amount: number, alpha = 1) => {
  const tone =
    amount >= 0
      ? `color-mix(in oklab, white ${amount}%, var(--primary))`
      : `color-mix(in oklab, black ${-amount}%, var(--primary))`;
  return alpha === 1
    ? tone
    : `color-mix(in oklab, ${tone} ${(alpha * 100).toFixed(0)}%, transparent)`;
};

const FACE_INDEXES = Array.from({ length: FACES }, (_, i) => i);

/**
 * Bit reversal: a permutation that puts consecutive indexes as far apart as it
 * can. Neighbouring faces need to disagree about how much light they caught —
 * smoothly shaded neighbours are exactly what stops a solid looking cut.
 */
const SPREAD = FACE_INDEXES.map((i) => {
  let out = 0;
  for (let bit = 1; bit < FACES; bit <<= 1) out = (out << 1) | (i & bit ? 1 : 0);
  return out / (FACES - 1);
});

export function RedDiamond({
  /** Width across the waist — any CSS length. The stone is 1.6× as tall. */
  size = "clamp(96px, 30vw, 132px)",
  className,
}: {
  size?: string;
  className?: string;
}) {
  return (
    <div
      aria-hidden
      className={`gem-stage ${className ?? ""}`}
      style={
        {
          "--gem": size,
          position: "relative",
          width: "var(--gem)",
          // The solid is 1.6 × `--gem` tall; the rest is room for the halo.
          height: `calc(var(--gem) * ${(HALF_HEIGHT + 0.12).toFixed(2)})`,
        } as React.CSSProperties
      }
    >
      {/*
        Halo and contact shadow. Both are deliberately *static*: a blur is the
        costliest thing per pixel in here, and a blurred element whose own
        opacity or transform animates is the one thing the compositor cannot
        rasterise once and then reuse. They were pulsing and squashing before,
        which nobody looking at the stone would notice and every frame had to
        pay for. The motion lives in the parts that are free to move.
      */}
      <div
        className="bg-primary/22 absolute rounded-full blur-xl"
        style={{ inset: "14% 2%" }}
      />

      <div
        className="bg-foreground/12 absolute rounded-[50%] blur-md"
        style={{ insetInline: len(0.62), bottom: len(0.04), height: len(0.14) }}
      />

      <div
        className="gem-float absolute inset-0"
        style={{ perspective: "calc(var(--gem) * 6)" }}
      >
        {/*
          The tilt is *negative* — screen Y points down, so a positive `rotateX`
          tips the top away and puts the viewer underneath the stone. Kept small:
          the ♦ is a symmetrical mark, and a steep view turns it into a lopsided
          one. No lift is needed to centre it, because the solid is mirrored.
        */}
        <div
          className="size-full"
          style={{ transformStyle: "preserve-3d", transform: "rotateX(-14deg)" }}
        >
          <div
            className="gem-spin relative size-full"
            style={{ transformStyle: "preserve-3d" }}
          >
            {HALVES.flatMap((paint, h) => {
              const geometry = ring(PROFILE[h], PROFILE[h + 1]);

              return FACE_INDEXES.map((i) => {
                const spread = paint.light - paint.dark;
                const near = paint.dark + spread * (0.4 + 0.6 * SPREAD[i]);
                const azimuth = (i * 360) / FACES;

                return (
                  <div
                    key={`${paint.name}-${i}`}
                    className="gem-face"
                    style={{
                      position: "absolute",
                      left: `calc(50% - ${len(geometry.width / 2)})`,
                      top: geometry.hangs
                        ? `calc(50% + ${len(geometry.hinge)})`
                        : `calc(50% + ${len(geometry.hinge)} - ${len(geometry.slant)})`,
                      width: len(geometry.width),
                      height: len(geometry.slant),
                      clipPath: geometry.clip,
                      transformOrigin: geometry.hangs ? "50% 0" : "50% 100%",
                      transform: `rotateY(${azimuth}deg) translateZ(${len(geometry.apothem)}) rotateX(${geometry.tilt.toFixed(3)}deg)`,
                      background: `linear-gradient(to ${geometry.hangs ? "bottom" : "top"}, ${mix(near + 26, paint.alpha)} 0%, ${mix(near, paint.alpha)} 5%, ${mix(paint.dark, paint.alpha)} 100%)`,
                    }}
                  />
                );
              });
            })}
          </div>
        </div>
      </div>

    </div>
  );
}
