import { NextResponse } from "next/server";

import { ConfigError } from "@/lib/config-error";
import { DirectoryTimeoutError, findPeople } from "@/lib/ldap";
import { getSessionFrom, unauthorizedResponse } from "@/lib/session";

export const dynamic = "force-dynamic";

/**
 * The one deliberate exception to "GET stays public everywhere". This is not app
 * content — it is a window onto the whole staff directory, and there is no reason
 * it should answer anonymously. The air-gapped posture accepts the enumeration
 * `?q=` on quotes already allows; it is not a licence to add a new, better one.
 */
export async function GET(request: Request) {
  const session = await getSessionFrom(request);
  if (!session) return unauthorizedResponse();

  const q = new URL(request.url).searchParams.get("q") ?? "";
  // Under two characters, answer without touching the directory — the server's
  // half of the editor's "לפחות שתי אותיות" rule.
  if (q.trim().length < 2) return NextResponse.json({ people: [] });

  try {
    // `findPeople` returns exactly the four client-safe fields — never dn/mail.
    const people = await findPeople(q);
    return NextResponse.json({ people });
  } catch (error) {
    // Kept apart from the 503 below on the same grounds ConfigError is: the
    // directory answered, it just refused to spend any longer on this query, so
    // "the directory is unavailable" would be untrue to the reader and would
    // point whoever investigates at a domain controller that is working.
    if (error instanceof DirectoryTimeoutError) {
      console.error("GET /api/directory timed out", error);
      return NextResponse.json(
        { error: "החיפוש ארך זמן רב מדי. נסו חיפוש ממוקד יותר" },
        { status: 504 },
      );
    }
    if (error instanceof ConfigError) {
      console.error("GET /api/directory misconfigured", error);
      return NextResponse.json(
        { error: "החיפוש בספרייה לא מוגדר בשרת" },
        { status: 500 },
      );
    }
    console.error("GET /api/directory failed", error);
    return NextResponse.json(
      { error: "לא הצלחנו לחפש בספריית הארגון" },
      { status: 503 },
    );
  }
}
