import { NextResponse } from "next/server";

import { fieldErrors } from "@/lib/api";
import { reorderMembers, rotationOrderSchema } from "@/lib/rotation";
import {
  forbiddenResponse,
  getSessionFrom,
  isSameOrigin,
  unauthorizedResponse,
} from "@/lib/session";

export const dynamic = "force-dynamic";

/**
 * A static segment, so it resolves here rather than to `[userId]` — the client
 * sends the whole stored order in the body and the store takes it verbatim
 * (last-write-wins). Only a malformed set is rejected.
 */
export async function PUT(request: Request) {
  if (!isSameOrigin(request)) return forbiddenResponse();

  const session = await getSessionFrom(request);
  if (!session) return unauthorizedResponse();

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "בקשה לא תקינה" }, { status: 400 });
  }

  const parsed = rotationOrderSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "יש שדות לא תקינים", issues: fieldErrors(parsed.error) },
      { status: 422 },
    );
  }

  try {
    const result = await reorderMembers(parsed.data.ids);
    if (!result.ok) {
      // An id not in the rotation, a duplicate, or the wrong count — input
      // validation, not a concurrency conflict, so nothing was written.
      return NextResponse.json({ error: "סדר לא תקין" }, { status: 422 });
    }
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("PUT /api/rotation/order failed", error);
    return NextResponse.json(
      { error: "לא הצלחנו לשמור את הסדר" },
      { status: 500 },
    );
  }
}
