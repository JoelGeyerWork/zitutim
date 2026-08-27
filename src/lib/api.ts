import { NextResponse } from "next/server";
import type { ZodError } from "zod";

import type { PersonFailure } from "@/lib/people";

/** Flatten a ZodError into { field: message } so a form can render it inline. */
export function fieldErrors(error: ZodError): Record<string, string> {
  const out: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = String(issue.path[0] ?? "form");
    out[key] ??= issue.message;
  }
  return out;
}

/**
 * The three ways `resolvePeople` can fail, as the three different answers they
 * are — shared so the two שוטף write paths cannot drift on which is which.
 *
 * `POST /api/rotation` and the login route already draw this line by hand: a
 * `ConfigError` is *this server* missing its `LDAP_*` block, which is a 500 and
 * an operator's problem, while an unreachable domain controller is a 503 and
 * somebody else's. A reference that names nobody is neither — it is bad input,
 * so it comes back as a 422 on `field`, which is where the form draws it.
 */
export function personFailureResponse(
  reason: PersonFailure,
  field: string,
  unknownMessage: string,
): NextResponse {
  if (reason === "misconfigured") {
    return NextResponse.json(
      { error: "החיפוש בספרייה לא מוגדר בשרת" },
      { status: 500 },
    );
  }
  if (reason === "unavailable") {
    return NextResponse.json(
      { error: "לא הצלחנו לפנות לספריית הארגון" },
      { status: 503 },
    );
  }
  return NextResponse.json(
    { error: "יש שדות לא תקינים", issues: { [field]: unknownMessage } },
    { status: 422 },
  );
}
