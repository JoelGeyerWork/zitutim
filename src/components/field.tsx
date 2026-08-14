"use client";

import { Label } from "@/components/ui/label";

/**
 * Label + optional marker + hint + inline error, shared by every form so the
 * error and required-field conventions can't drift between them.
 */
export function Field({
  id,
  label,
  optional,
  hint,
  error,
  children,
}: {
  id: string;
  label: string;
  optional?: boolean;
  hint?: string;
  error?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-2">
      <div className="flex items-baseline justify-between gap-2">
        <Label htmlFor={id} className="text-sm font-semibold">
          {label}
          {optional ? (
            <span className="text-muted-foreground me-1 font-normal">
              {" "}
              (לא חובה)
            </span>
          ) : (
            <span className="text-primary" aria-hidden>
              {" "}
              *
            </span>
          )}
        </Label>
        {hint && !error ? (
          <span className="text-muted-foreground text-xs">{hint}</span>
        ) : null}
      </div>
      {children}
      {error ? (
        <p role="alert" className="text-destructive text-xs font-medium">
          {error}
        </p>
      ) : null}
    </div>
  );
}
