import { RedDiamond } from "@/components/red-diamond";
import { HUB } from "@/lib/navigation";

/**
 * The hub's greeting and the stone. Kept out of `page.tsx` so a long first
 * name can be rendered without standing up Mongo, which is how the overflow
 * classes below get a test.
 */
export function HubHero({ firstName }: { firstName: string }) {
  return (
    <section className="relative isolate">
      <Backdrop />

      {/* `w-full min-w-0` on the measure *and* the copy: a long first name
          is one unbreakable word at 5xl, and without a floor of zero
          `max-w-2xl` loses to min-content — the heading inflates the page
          and paints through the stone. `break-words` is what actually
          wraps it; `min-w-0` is what lets the box stay the measure.
          `w-full` on the copy is because this row is `items-center`, which
          otherwise sizes the text to the name instead of the column. */}
      <div className="mx-auto flex w-full min-w-0 max-w-2xl flex-col items-center gap-6 px-4 pt-8 pb-6 text-center sm:flex-row sm:gap-10 sm:pt-14 sm:pb-10 sm:text-start">
        <div className="w-full min-w-0 flex-1">
          {/* Not the app's name — the wordmark in the header already says
              that. */}
          <h1 className="break-words text-4xl font-black tracking-tight sm:text-5xl">
            היי,{" "}
            <span className="hub-name from-primary to-chart-3 bg-linear-to-l bg-clip-text text-transparent">
              {firstName}
            </span>
            .
          </h1>
          <p className="text-muted-foreground mt-3 text-lg">{HUB.description}</p>
        </div>

        {/* Leads on a phone, where the column stacks: the stone is the
            page's idea, and the greeting reads better under it than over
            it. Beside the text once there is room for both. */}
        <RedDiamond
          size="clamp(112px, 28vw, 150px)"
          className="shrink-0 max-sm:order-first"
        />
      </div>
    </section>
  );
}

/**
 * The hero's ground: a faint grid fading out from the middle, and one red glow
 * behind the stone. Both are static CSS — the gem is the only thing on this
 * page that is allowed to keep moving.
 *
 * The clip lives here and not on the section. The glow is far larger than the
 * hero and has to be cut somewhere, but an `overflow` on the section would cut
 * the stone too — perspective swells its near corner past the stage, and the
 * float carries it a few pixels further — and on WebKit a clipping ancestor
 * can flatten a `preserve-3d` descendant, which would put every frame back on
 * the raster path the layer promotion exists to avoid.
 */
function Backdrop() {
  return (
    <div aria-hidden className="absolute inset-0 -z-10 overflow-hidden">
      <div className="absolute inset-0 bg-[linear-gradient(to_right,var(--border)_1px,transparent_1px),linear-gradient(to_bottom,var(--border)_1px,transparent_1px)] bg-[size:32px_32px] [mask-image:radial-gradient(ellipse_70%_80%_at_50%_30%,black_10%,transparent_75%)]" />
      <div className="bg-primary/15 absolute top-0 left-1/2 h-[26rem] w-[40rem] -translate-x-1/2 -translate-y-1/3 rounded-full blur-3xl" />
    </div>
  );
}
