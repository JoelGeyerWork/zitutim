import { NextResponse } from "next/server";

import { fieldErrors } from "@/lib/api";
import {
  forbiddenResponse,
  getSessionFrom,
  isSameOrigin,
  unauthorizedResponse,
} from "@/lib/session";
import {
  PAGE_SIZE,
  SORT_OPTIONS,
  createQuote,
  listQuotes,
  quoteInputSchema,
  type SortOption,
} from "@/lib/quotes";

export const dynamic = "force-dynamic";

/** Deliberately public: anyone who can reach the wall can read it. */
export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;

  const sortParam = params.get("sort");
  const sort = SORT_OPTIONS.includes(sortParam as SortOption)
    ? (sortParam as SortOption)
    : "added";

  try {
    const session = await getSessionFrom(request);
    const page = await listQuotes({
      search: params.get("q") ?? undefined,
      sort,
      skip: Number(params.get("skip")) || 0,
      limit: Number(params.get("limit")) || PAGE_SIZE,
      viewerId: session?.id,
    });
    return NextResponse.json(page);
  } catch (error) {
    console.error("GET /api/quotes failed", error);
    return NextResponse.json(
      { error: "לא הצלחנו לטעון את הציטוטים" },
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

  const parsed = quoteInputSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "יש שדות לא תקינים", issues: fieldErrors(parsed.error) },
      { status: 422 },
    );
  }

  try {
    const quote = await createQuote(parsed.data, {
      id: session.id,
      name: session.name,
    });
    return NextResponse.json(quote, { status: 201 });
  } catch (error) {
    console.error("POST /api/quotes failed", error);
    return NextResponse.json(
      { error: "לא הצלחנו לשמור את הציטוט" },
      { status: 500 },
    );
  }
}
