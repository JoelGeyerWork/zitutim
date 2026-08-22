import { NextResponse } from "next/server";

import { fieldErrors } from "@/lib/api";
import { ConfigError } from "@/lib/config-error";
import { findPersonById } from "@/lib/ldap";
import {
  addMember,
  getRotation,
  rotationAddSchema,
} from "@/lib/rotation";
import {
  forbiddenResponse,
  getSessionFrom,
  isSameOrigin,
  unauthorizedResponse,
} from "@/lib/session";
import { upsertRosterUser } from "@/lib/users";

export const dynamic = "force-dynamic";

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
    const roster = await getRotation();
    return NextResponse.json({ members: roster.map(member) });
  } catch (error) {
    console.error("GET /api/rotation failed", error);
    return NextResponse.json(
      { error: "לא הצלחנו לטעון את הסבב" },
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
      console.error("POST /api/rotation misconfigured", error);
      return NextResponse.json(
        { error: "החיפוש בספרייה לא מוגדר בשרת" },
        { status: 500 },
      );
    }
    console.error("POST /api/rotation directory lookup failed", error);
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
    const userId = await upsertRosterUser(person);
    const result = await addMember(userId, parsed.data.gender);
    if (!result.ok) {
      return NextResponse.json({ error: "כבר בסבב" }, { status: 409 });
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
    console.error("POST /api/rotation failed", error);
    return NextResponse.json(
      { error: "לא הצלחנו להוסיף לסבב" },
      { status: 500 },
    );
  }
}
