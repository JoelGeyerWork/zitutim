import { NextResponse } from "next/server";

import {
  SESSION_COOKIE,
  forbiddenResponse,
  isSameOrigin,
  sessionCookieOptions,
} from "@/lib/session";

export const dynamic = "force-dynamic";

/**
 * POST rather than GET on purpose: a GET logout is triggerable by an `<img>`
 * tag on any page, which turns signing people out into a drive-by.
 */
export async function POST(request: Request) {
  if (!isSameOrigin(request)) return forbiddenResponse();

  const response = new NextResponse(null, { status: 204 });
  response.cookies.set(SESSION_COOKIE, "", {
    ...sessionCookieOptions(new Date(0)),
    maxAge: 0,
  });
  response.headers.set("Cache-Control", "no-store");
  return response;
}
