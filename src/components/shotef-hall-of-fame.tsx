import { CheckCircle2Icon, TimerIcon, TrophyIcon } from "lucide-react";

import { PersonAvatar } from "@/components/person-avatar";
import { Badge } from "@/components/ui/badge";
import { formatSaidAtShort, plural } from "@/lib/format";
import {
  SEVERITY_LABELS,
  memberById,
  type MonitorSeverity,
  type SolvedMonitor,
} from "@/lib/shotef";

/**
 * Red is the only chromatic hue in the palette, so severity is spelled by
 * weight rather than by colour: the loudest monitor gets the filled badge.
 */
const SEVERITY_VARIANT: Record<
  MonitorSeverity,
  "default" | "secondary" | "outline"
> = {
  critical: "default",
  major: "secondary",
  minor: "outline",
};

export function HallOfFame({ monitors }: { monitors: SolvedMonitor[] }) {
  return (
    <div className="space-y-4">
      <section className="bg-accent text-accent-foreground flex items-center gap-4 rounded-2xl border border-transparent p-5">
        <TrophyIcon className="text-primary size-8 shrink-0" />
        <div className="min-w-0">
          <p className="font-semibold">
            {plural(monitors.length, "מוניטור אחד שנסגר", "מוניטורים שנסגרו")}
          </p>
          <p className="mt-1 text-sm opacity-80 text-balance">
            כל אחד מהם צעק פעם, ומישהו בתורנות הפסיק את זה. אם הוא יצעק שוב —
            התשובה כבר כתובה כאן.
          </p>
        </div>
      </section>

      <ol className="space-y-3">
        {monitors.map((monitor) => (
          <li key={monitor.id}>
            <MonitorCard monitor={monitor} />
          </li>
        ))}
      </ol>
    </div>
  );
}

function MonitorCard({ monitor }: { monitor: SolvedMonitor }) {
  const solver = memberById(monitor.solvedById);
  const name = solver?.name ?? "לא ידוע";

  return (
    <article className="bg-card rounded-2xl border p-5 shadow-sm">
      <header className="flex flex-wrap items-start justify-between gap-2">
        {/* The monitor is quoted exactly as the alerting system spells it —
            LTR and monospaced, so it can be searched for there letter by
            letter rather than translated by memory. */}
        <code
          dir="ltr"
          className="bg-muted text-foreground min-w-0 rounded-md px-2 py-1 font-mono text-sm break-all"
        >
          {monitor.monitor}
        </code>
        <Badge variant={SEVERITY_VARIANT[monitor.severity]}>
          {SEVERITY_LABELS[monitor.severity]}
        </Badge>
      </header>

      <div className="mt-4">
        <h3 className="text-muted-foreground flex items-center gap-1.5 text-xs font-semibold">
          <CheckCircle2Icon className="text-primary size-3.5" />
          איך פתרנו
        </h3>
        <p className="mt-2 text-sm leading-relaxed">{monitor.solution}</p>
      </div>

      <footer className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-2 border-t pt-3">
        <PersonAvatar name={name} className="size-7 text-xs" />
        <span className="text-sm font-medium">{name}</span>
        <span className="text-muted-foreground text-xs">
          {formatSaidAtShort(monitor.solvedAt)}
        </span>
        <span className="text-muted-foreground ms-auto flex items-center gap-1 text-xs">
          <TimerIcon className="size-3.5" aria-hidden />
          {monitor.timeToFix}
        </span>
      </footer>
    </article>
  );
}
