import { NextResponse } from "next/server";

import { fieldErrors } from "@/lib/api";
import { ConfigError } from "@/lib/config-error";
import { findPersonById } from "@/lib/ldap";
import { rotationAddSchema } from "@/lib/rotation";
import { addShotefMember, getShotefRotation } from "@/lib/shotef";
import {
  forbiddenResponse,
  getSessionFrom,
  isSameOrigin,
  unauthorizedResponse,
} from "@/lib/session";
import { upsertRosterUser } from "@/lib/users";

export const dynamic = "force-dynamic";

/**
 * The on-call rotation, as its own resource under `/api/shotef`. It mirrors
 * `/api/rotation` deliberately — same body schemas, same directory
 * re-resolution, same 409s — because the two rotations are one store behind a
 * key, and the section they belong to is the only thing that differs.
 */

/** The public shape of a rotation member — never `directoryId`. */
function member(entry: {
  id: string;
  name: string;
  role: string;
  gender: "m" | "f";
}) {
  return {
    userId: entry.id,
    name: entry.name,
    title: entry.role,
    gender: entry.gender,
  };
}

/** Deliberately public: the wheel is a public read, so the rotation is too. */
export async function GET() {
  try {
    const roster = await getShotefRotation();
    return NextResponse.json({ members: roster.map(member) });
  } catch (error) {
    console.error("GET /api/shotef/rotation failed", error);
    return NextResponse.json(
      { error: "לא הצלחנו לטעון את התורנות" },
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

  const parsed = rotationAddSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "יש שדות לא תקינים", issues: fieldErrors(parsed.error) },
      { status: 422 },
    );
  }

  // Re-resolve the person server-side, so nothing the client typed lands in the
  // stored name or title.
  let person;
  try {
    person = await findPersonById(parsed.data.directoryId);
  } catch (error) {
    if (error instanceof ConfigError) {
      console.error("POST /api/shotef/rotation misconfigured", error);
      return NextResponse.json(
        { error: "החיפוש בספרייה לא מוגדר בשרת" },
        { status: 500 },
      );
    }
    console.error("POST /api/shotef/rotation directory lookup failed", error);
    return NextResponse.json(
      { error: "לא הצלחנו לפנות לספריית הארגון" },
      { status: 503 },
    );
  }

  // An id that resolves to nobody is invalid input, not a server fault.
  if (!person) {
    return NextResponse.json(
      { error: "יש שדות לא תקינים", issues: { directoryId: "לא נמצא בספרייה" } },
      { status: 422 },
    );
  }

  try {
    // The same `users` row the meetup rotation and the themes point at: someone
    // in both rotations is one person here, not two.
    const userId = await upsertRosterUser(person);
    const result = await addShotefMember(userId, parsed.data.gender);
    if (!result.ok) {
      return NextResponse.json({ error: "כבר בתורנות" }, { status: 409 });
    }
    return NextResponse.json(
      {
        member: member({
          id: userId,
          name: person.displayName,
          role: person.title ?? "",
          gender: parsed.data.gender,
        }),
      },
      { status: 201 },
    );
  } catch (error) {
    console.error("POST /api/shotef/rotation failed", error);
    return NextResponse.json(
      { error: "לא הצלחנו להוסיף לתורנות" },
      { status: 500 },
    );
  }
}
