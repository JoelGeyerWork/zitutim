import { NextResponse } from "next/server";

import { fieldErrors } from "@/lib/api";
import {
  commentInputSchema,
  deleteComment,
  updateComment,
} from "@/lib/engagement";
import {
  forbiddenResponse,
  getSessionFrom,
  isSameOrigin,
  unauthorizedResponse,
} from "@/lib/session";

export const dynamic = "force-dynamic";

type Params = {
  params: Promise<{ id: string; commentId: string }>;
};

const NOT_FOUND = "התגובה לא נמצאה";

export async function PUT(request: Request, { params }: Params) {
  const { id, commentId } = await params;
  if (!isSameOrigin(request)) return forbiddenResponse();

  const session = await getSessionFrom(request);
  if (!session) return unauthorizedResponse();

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "בקשה לא תקינה" }, { status: 400 });
  }

  const parsed = commentInputSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "יש שדות לא תקינים", issues: fieldErrors(parsed.error) },
      { status: 422 },
    );
  }

  try {
    const result = await updateComment(
      id,
      commentId,
      parsed.data,
      session.id,
    );
    if (result.status === "forbidden") return forbiddenResponse();
    if (result.status === "not_found") {
      return NextResponse.json({ error: NOT_FOUND }, { status: 404 });
    }
    return NextResponse.json(result.comment);
  } catch (error) {
    console.error(
      `PUT /api/quotes/${id}/comments/${commentId} failed`,
      error,
    );
    return NextResponse.json(
      { error: "לא הצלחנו לעדכן את התגובה" },
      { status: 500 },
    );
  }
}

export async function DELETE(request: Request, { params }: Params) {
  const { id, commentId } = await params;
  if (!isSameOrigin(request)) return forbiddenResponse();

  const session = await getSessionFrom(request);
  if (!session) return unauthorizedResponse();

  try {
    const result = await deleteComment(id, commentId, session.id);
    if (result.status === "forbidden") return forbiddenResponse();
    if (result.status === "not_found") {
      return NextResponse.json({ error: NOT_FOUND }, { status: 404 });
    }
    return new NextResponse(null, { status: 204 });
  } catch (error) {
    console.error(
      `DELETE /api/quotes/${id}/comments/${commentId} failed`,
      error,
    );
    return NextResponse.json(
      { error: "לא הצלחנו למחוק את התגובה" },
      { status: 500 },
    );
  }
}
