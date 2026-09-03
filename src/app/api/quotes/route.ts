import { NextResponse } from "next/server";

import { fieldErrors, personFailureResponse } from "@/lib/api";
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
  resolveQuoteAuthor,
  type SortOption,
} from "@/lib/quotes";

export const dynamic = "force-dynamic";

/** A reference naming nobody is bad input, and it is this field that is wrong. */
const UNKNOWN_AUTHOR = "לא מצאנו את מי שנבחר";

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
    // The schema only knows the body *names* a speaker; this is where that
    // becomes a name to store and, when they were picked rather than typed, the
    // `users` row behind it. Inside the try because it can be a database call.
    const author = await resolveQuoteAuthor(parsed.data.author);
    if (!author.ok) {
      return personFailureResponse(author.reason, "author", UNKNOWN_AUTHOR);
    }

    const quote = await createQuote(parsed.data, author.author, {
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
