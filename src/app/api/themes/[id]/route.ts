import { NextResponse } from "next/server";

import { fieldErrors } from "@/lib/api";
import {
  forbiddenResponse,
  getSessionFrom,
  isSameOrigin,
  unauthorizedResponse,
} from "@/lib/session";
import {
  deleteTheme,
  getTheme,
  resolveThemeMembers,
  themeInputSchema,
  updateTheme,
} from "@/lib/themes";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

/** A unique-index collision — one meetup already has a theme for that date. */
function isDuplicateKey(error: unknown): boolean {
  return (
    !!error &&
    typeof error === "object" &&
    (error as { code?: number }).code === 11000
  );
}

const DUPLICATE_DATE = "כבר קיים נושא לתאריך הזה";
const NOT_FOUND = "הנושא לא נמצא";

/** Deliberately public, like the collection GET. */
export async function GET(_request: Request, { params }: Params) {
  const { id } = await params;
  const theme = await getTheme(id);
  if (!theme) {
    return NextResponse.json({ error: NOT_FOUND }, { status: 404 });
  }
  return NextResponse.json(theme);
}

export async function PUT(request: Request, { params }: Params) {
  const { id } = await params;

  if (!isSameOrigin(request)) return forbiddenResponse();

  // Ahead of the id lookup as well as the parse, so an anonymous caller can't
  // use the 404 to learn which ids exist.
  const session = await getSessionFrom(request);
  if (!session) return unauthorizedResponse();

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "בקשה לא תקינה" }, { status: 400 });
  }

  const parsed = themeInputSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "יש שדות לא תקינים", issues: fieldErrors(parsed.error) },
      { status: 422 },
    );
  }

  const resolved = await resolveThemeMembers(parsed.data);
  if (!resolved.ok) {
    return NextResponse.json(
      { error: "יש שדות לא תקינים", issues: resolved.issues },
      { status: 422 },
    );
  }

  try {
    const theme = await updateTheme(id, parsed.data, resolved.members, {
      id: session.id,
      name: session.name,
    });
    if (!theme) {
      return NextResponse.json({ error: NOT_FOUND }, { status: 404 });
    }
    return NextResponse.json(theme);
  } catch (error) {
    if (isDuplicateKey(error)) {
      return NextResponse.json({ error: DUPLICATE_DATE }, { status: 409 });
    }
    console.error(`PUT /api/themes/${id} failed`, error);
    return NextResponse.json(
      { error: "לא הצלחנו לעדכן את הנושא" },
      { status: 500 },
    );
  }
}

export async function DELETE(request: Request, { params }: Params) {
  const { id } = await params;

  if (!isSameOrigin(request)) return forbiddenResponse();

  const session = await getSessionFrom(request);
  if (!session) return unauthorizedResponse();

  try {
    const deleted = await deleteTheme(id);
    if (!deleted) {
      return NextResponse.json({ error: NOT_FOUND }, { status: 404 });
    }
    return new NextResponse(null, { status: 204 });
  } catch (error) {
    console.error(`DELETE /api/themes/${id} failed`, error);
    return NextResponse.json(
      { error: "לא הצלחנו למחוק את הנושא" },
      { status: 500 },
    );
  }
}
