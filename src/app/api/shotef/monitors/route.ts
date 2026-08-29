import { NextResponse } from "next/server";

import { fieldErrors, personFailureResponse } from "@/lib/api";
import { resolvePeople } from "@/lib/people";
import {
  createMonitor,
  getHallOfFame,
  monitorInputSchema,
} from "@/lib/shotef-monitors";
import {
  forbiddenResponse,
  getSessionFrom,
  isSameOrigin,
  unauthorizedResponse,
} from "@/lib/session";

export const dynamic = "force-dynamic";

/**
 * היכל התהילה — the certificates, and the two aggregates the page renders beside
 * them. Both are computed across the whole collection rather than left to a
 * caller to reduce out of `monitors`, so a client that one day holds only part
 * of the wall still shows a podium that is true of all of it.
 *
 * Deliberately public, and deliberately the same `getHallOfFame` the page reads
 * — a refetch cannot come back shaped differently from the server render.
 */
export async function GET() {
  try {
    return NextResponse.json(await getHallOfFame());
  } catch (error) {
    console.error("GET /api/shotef/monitors failed", error);
    return NextResponse.json(
      { error: "לא הצלחנו לטעון את היכל התהילה" },
      { status: 500 },
    );
  }
}

export async function POST(request: Request) {
  if (!isSameOrigin(request)) return forbiddenResponse();

  // Before parsing, not after: an anonymous caller gets a 401 rather than a 422,
  // so validation behaviour is never a probing oracle.
  const session = await getSessionFrom(request);
  if (!session) return unauthorizedResponse();

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "בקשה לא תקינה" }, { status: 400 });
  }

  // The same schema the dialog validates against — including the dedupe of
  // `solvedByIds` and the refusal of a monitor solved before it first fired.
  // The form's copy is for responsiveness; this one is the authority.
  const parsed = monitorInputSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "יש שדות לא תקינים", issues: fieldErrors(parsed.error) },
      { status: 422 },
    );
  }

  try {
    // Every name on the certificate turned into a `users` row. A list picked
    // out of the rotation is all `{ source: "user" }`, which resolves out of
    // Mongo and never opens an LDAP connection; a colleague found in the
    // directory is re-resolved with `findPersonById` and written through
    // `upsertRosterUser`, so a plaque can credit somebody this app had never
    // seen without the client naming them.
    //
    // Inside the try because it is a database call: a fault here is a 500 with
    // a log line, like any other, rather than an unhandled rejection.
    const resolution = await resolvePeople(parsed.data.solvedBy);
    if (!resolution.ok) {
      return personFailureResponse(
        resolution.reason,
        "solvedBy",
        "אחד מהשמות לא נמצא ברשימה",
      );
    }

    // The clerk is the session, never the body: who *solved* it is `solvedBy`,
    // and who typed the certificate in is a separate fact. The resolved solvers
    // are handed on so the write path reads `users` once.
    const monitor = await createMonitor(
      parsed.data,
      { id: session.id, name: session.name },
      resolution.people,
    );
    return NextResponse.json(monitor, { status: 201 });
  } catch (error) {
    console.error("POST /api/shotef/monitors failed", error);
    return NextResponse.json(
      { error: "לא הצלחנו לשמור את התעודה" },
      { status: 500 },
    );
  }
}
