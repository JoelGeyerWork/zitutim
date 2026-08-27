import { NextResponse } from "next/server";

import { fieldErrors } from "@/lib/api";
import {
  forbiddenResponse,
  getSessionFrom,
  isSameOrigin,
  unauthorizedResponse,
} from "@/lib/session";
import {
  THEME_PAGE_SIZE,
  createTheme,
  listThemes,
  resolveThemeMembers,
  themeInputSchema,
} from "@/lib/themes";

export const dynamic = "force-dynamic";

/** A unique-index collision — one meetup already has a theme for that date. */
function isDuplicateKey(error: unknown): boolean {
  return (
    !!error &&
    typeof error === "object" &&
    (error as { code?: number }).code === 11000
  );
}

const DUPLICATE_DATE = "כבר קיים נושא לתאריך הזה";

/** Deliberately public: anyone who can reach the hub can read the history. */
export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;

  try {
    const page = await listThemes({
      search: params.get("q") ?? undefined,
      skip: Number(params.get("skip")) || 0,
      limit: Number(params.get("limit")) || THEME_PAGE_SIZE,
    });
    return NextResponse.json(page);
  } catch (error) {
    console.error("GET /api/themes failed", error);
    return NextResponse.json(
      { error: "לא הצלחנו לטעון את הנושאים" },
      { status: 500 },
    );
  }
}

export async function POST(request: Request) {
  if (!isSameOrigin(request)) return forbiddenResponse();

  // Before parsing, not after: an anonymous caller should get a 401 rather than
  // a 400 or 422, or the validation behaviour becomes a probing oracle.
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

  // An id that resolves to no user is invalid input, not a server fault.
  const resolved = await resolveThemeMembers(parsed.data);
  if (!resolved.ok) {
    return NextResponse.json(
      { error: "יש שדות לא תקינים", issues: resolved.issues },
      { status: 422 },
    );
  }

  try {
    const theme = await createTheme(parsed.data, resolved.members, {
      id: session.id,
      name: session.name,
    });
    return NextResponse.json(theme, { status: 201 });
  } catch (error) {
    if (isDuplicateKey(error)) {
      return NextResponse.json({ error: DUPLICATE_DATE }, { status: 409 });
    }
    console.error("POST /api/themes failed", error);
    return NextResponse.json(
      { error: "לא הצלחנו לשמור את הנושא" },
      { status: 500 },
    );
  }
}
