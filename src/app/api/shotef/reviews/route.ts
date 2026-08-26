import { NextResponse } from "next/server";

import { fieldErrors } from "@/lib/api";
import {
  forbiddenResponse,
  getSessionFrom,
  isSameOrigin,
  unauthorizedResponse,
} from "@/lib/session";
import {
  createShotefReview,
  getShotefReviews,
  reviewInputSchema,
  reviewMemberExists,
} from "@/lib/shotef-reviews";

export const dynamic = "force-dynamic";

/** A unique-index collision — that week already has its summary. */
function isDuplicateKey(error: unknown): boolean {
  return (
    !!error &&
    typeof error === "object" &&
    (error as { code?: number }).code === 11000
  );
}

const DUPLICATE_WEEK = "כבר יש סיכום לשבוע הזה";

/** Deliberately public: the summaries are read by anyone who can reach the app. */
export async function GET() {
  try {
    return NextResponse.json(await getShotefReviews());
  } catch (error) {
    console.error("GET /api/shotef/reviews failed", error);
    return NextResponse.json(
      { error: "לא הצלחנו לטעון את הסיכומים" },
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

  const parsed = reviewInputSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "יש שדות לא תקינים", issues: fieldErrors(parsed.error) },
      { status: 422 },
    );
  }

  // A member id that resolves to nobody is invalid input, not a server fault —
  // the schema only knows the field is a non-empty string.
  if (!(await reviewMemberExists(parsed.data.memberId))) {
    return NextResponse.json(
      { error: "יש שדות לא תקינים", issues: { memberId: "לא נמצא ברשימה" } },
      { status: 422 },
    );
  }

  try {
    // The author is the session, never the body: whose *week* it was is
    // `memberId`, and who wrote it up is a separate fact.
    const review = await createShotefReview(parsed.data, {
      id: session.id,
      name: session.name,
    });
    return NextResponse.json(review, { status: 201 });
  } catch (error) {
    if (isDuplicateKey(error)) {
      return NextResponse.json({ error: DUPLICATE_WEEK }, { status: 409 });
    }
    console.error("POST /api/shotef/reviews failed", error);
    return NextResponse.json(
      { error: "לא הצלחנו לשמור את הסיכום" },
      { status: 500 },
    );
  }
}
