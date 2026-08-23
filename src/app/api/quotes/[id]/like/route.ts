import { NextResponse } from "next/server";

import { fieldErrors } from "@/lib/api";
import { likeInputSchema, setQuoteLike } from "@/lib/engagement";
import {
  forbiddenResponse,
  getSessionFrom,
  isSameOrigin,
  unauthorizedResponse,
} from "@/lib/session";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

export async function PUT(request: Request, { params }: Params) {
  const { id } = await params;
  if (!isSameOrigin(request)) return forbiddenResponse();

  const session = await getSessionFrom(request);
  if (!session) return unauthorizedResponse();

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "בקשה לא תקינה" }, { status: 400 });
  }

  const parsed = likeInputSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "יש שדות לא תקינים", issues: fieldErrors(parsed.error) },
      { status: 422 },
    );
  }

  try {
    const state = await setQuoteLike(id, session.id, parsed.data.liked);
    if (!state) {
      return NextResponse.json(
        { error: "הציטוט לא נמצא" },
        { status: 404 },
      );
    }
    return NextResponse.json(state);
  } catch (error) {
    console.error(`PUT /api/quotes/${id}/like failed`, error);
    return NextResponse.json(
      { error: "לא הצלחנו לעדכן את הלייק" },
      { status: 500 },
    );
  }
}
