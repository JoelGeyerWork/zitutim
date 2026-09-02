import { NextResponse } from "next/server";

import { fieldErrors, personFailureResponse } from "@/lib/api";
import {
  forbiddenResponse,
  getSessionFrom,
  isSameOrigin,
  unauthorizedResponse,
} from "@/lib/session";
import {
  deleteQuote,
  getQuote,
  quoteInputSchema,
  resolveQuoteAuthor,
  updateQuote,
} from "@/lib/quotes";

export const dynamic = "force-dynamic";

/** A reference naming nobody is bad input, and it is this field that is wrong. */
const UNKNOWN_AUTHOR = "לא מצאנו את מי שנבחר";

type Params = { params: Promise<{ id: string }> };

/** Deliberately public, like the collection GET. */
export async function GET(request: Request, { params }: Params) {
  const { id } = await params;
  const session = await getSessionFrom(request);
  const quote = await getQuote(id, session?.id);
  if (!quote) {
    return NextResponse.json({ error: "הציטוט לא נמצא" }, { status: 404 });
  }
  return NextResponse.json(quote);
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

  const parsed = quoteInputSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "יש שדות לא תקינים", issues: fieldErrors(parsed.error) },
      { status: 422 },
    );
  }

  try {
    // As in POST: the reference becomes a name, and an id when there is one.
    const author = await resolveQuoteAuthor(parsed.data.author);
    if (!author.ok) {
      return personFailureResponse(author.reason, "author", UNKNOWN_AUTHOR);
    }

    const quote = await updateQuote(id, parsed.data, author.author, {
      id: session.id,
      name: session.name,
    });
    if (!quote) {
      return NextResponse.json({ error: "הציטוט לא נמצא" }, { status: 404 });
    }
    return NextResponse.json(quote);
  } catch (error) {
    console.error(`PUT /api/quotes/${id} failed`, error);
    return NextResponse.json(
      { error: "לא הצלחנו לעדכן את הציטוט" },
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
    const deleted = await deleteQuote(id);
    if (!deleted) {
      return NextResponse.json({ error: "הציטוט לא נמצא" }, { status: 404 });
    }
    return new NextResponse(null, { status: 204 });
  } catch (error) {
    console.error(`DELETE /api/quotes/${id} failed`, error);
    return NextResponse.json(
      { error: "לא הצלחנו למחוק את הציטוט" },
      { status: 500 },
    );
  }
}
