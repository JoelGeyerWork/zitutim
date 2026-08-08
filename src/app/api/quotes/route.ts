import { NextResponse } from "next/server";

import { fieldErrors } from "@/lib/api";
import {
  PAGE_SIZE,
  SORT_OPTIONS,
  createQuote,
  listQuotes,
  quoteInputSchema,
  type SortOption,
} from "@/lib/quotes";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;

  const sortParam = params.get("sort");
  const sort = SORT_OPTIONS.includes(sortParam as SortOption)
    ? (sortParam as SortOption)
    : "added";

  try {
    const page = await listQuotes({
      search: params.get("q") ?? undefined,
      sort,
      skip: Number(params.get("skip")) || 0,
      limit: Number(params.get("limit")) || PAGE_SIZE,
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
    const quote = await createQuote(parsed.data);
    return NextResponse.json(quote, { status: 201 });
  } catch (error) {
    console.error("POST /api/quotes failed", error);
    return NextResponse.json(
      { error: "לא הצלחנו לשמור את הציטוט" },
      { status: 500 },
    );
  }
}
