import { NextResponse } from "next/server";

import { fieldErrors } from "@/lib/api";
import {
  commentInputSchema,
  createComment,
  listComments,
} from "@/lib/engagement";
import {
  forbiddenResponse,
  getSessionFrom,
  isSameOrigin,
  unauthorizedResponse,
} from "@/lib/session";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

export async function GET(_request: Request, { params }: Params) {
  const { id } = await params;
  try {
    const comments = await listComments(id);
    if (!comments) {
      return NextResponse.json(
        { error: "הציטוט לא נמצא" },
        { status: 404 },
      );
    }
    return NextResponse.json({ comments });
  } catch (error) {
    console.error(`GET /api/quotes/${id}/comments failed`, error);
    return NextResponse.json(
      { error: "לא הצלחנו לטעון את התגובות" },
      { status: 500 },
    );
  }
}

export async function POST(request: Request, { params }: Params) {
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

  const parsed = commentInputSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "יש שדות לא תקינים", issues: fieldErrors(parsed.error) },
      { status: 422 },
    );
  }

  try {
    const comment = await createComment(id, parsed.data, session.id);
    if (!comment) {
      return NextResponse.json(
        { error: "הציטוט לא נמצא" },
        { status: 404 },
      );
    }
    return NextResponse.json(comment, { status: 201 });
  } catch (error) {
    console.error(`POST /api/quotes/${id}/comments failed`, error);
    return NextResponse.json(
      { error: "לא הצלחנו לשמור את התגובה" },
      { status: 500 },
    );
  }
}
