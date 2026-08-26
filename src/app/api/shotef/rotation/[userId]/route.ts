import { NextResponse } from "next/server";

import { fieldErrors } from "@/lib/api";
import { rotationGenderSchema } from "@/lib/rotation";
import { removeShotefMember, setShotefGender } from "@/lib/shotef";
import {
  forbiddenResponse,
  getSessionFrom,
  isSameOrigin,
  unauthorizedResponse,
} from "@/lib/session";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ userId: string }> };

export async function DELETE(request: Request, { params }: Params) {
  if (!isSameOrigin(request)) return forbiddenResponse();

  const session = await getSessionFrom(request);
  if (!session) return unauthorizedResponse();

  const { userId } = await params;

  try {
    const outcome = await removeShotefMember(userId);
    if (outcome === "not-found") {
      return NextResponse.json({ error: "לא נמצא בתורנות" }, { status: 404 });
    }
    if (outcome === "last") {
      // An empty rotation has nobody on duty and no week to render, so the last
      // member cannot be removed — the same refusal the ישב״צ rotation makes.
      return NextResponse.json(
        { error: "צריך שיישאר לפחות אדם אחד בתורנות" },
        { status: 409 },
      );
    }
    return new NextResponse(null, { status: 204 });
  } catch (error) {
    console.error(`DELETE /api/shotef/rotation/${userId} failed`, error);
    return NextResponse.json(
      { error: "לא הצלחנו להוציא מהתורנות" },
      { status: 500 },
    );
  }
}

export async function PATCH(request: Request, { params }: Params) {
  if (!isSameOrigin(request)) return forbiddenResponse();

  // Session before parse, same as every other mutation.
  const session = await getSessionFrom(request);
  if (!session) return unauthorizedResponse();

  const { userId } = await params;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "בקשה לא תקינה" }, { status: 400 });
  }

  const parsed = rotationGenderSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "יש שדות לא תקינים", issues: fieldErrors(parsed.error) },
      { status: 422 },
    );
  }

  try {
    const updated = await setShotefGender(userId, parsed.data.gender);
    if (!updated) {
      return NextResponse.json({ error: "לא נמצא בתורנות" }, { status: 404 });
    }
    return NextResponse.json({ userId, gender: parsed.data.gender });
  } catch (error) {
    console.error(`PATCH /api/shotef/rotation/${userId} failed`, error);
    return NextResponse.json(
      { error: "לא הצלחנו לעדכן את התורנות" },
      { status: 500 },
    );
  }
}
