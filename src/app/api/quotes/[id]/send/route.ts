import { NextResponse } from "next/server";

import { ConfigError } from "@/lib/config-error";
import { sendMail } from "@/lib/mail";
import { buildQuoteEmail } from "@/lib/quote-email";
import { getQuote } from "@/lib/quotes";
import {
  forbiddenResponse,
  getSessionFrom,
  isSameOrigin,
  unauthorizedResponse,
} from "@/lib/session";
import { getUserMail } from "@/lib/users";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

/**
 * Mails one quote to the team list, with the printable document attached.
 *
 * A write in every sense that matters — it leaves the building — so it takes
 * the same guards as the other mutations: same-origin, then a session, and only
 * then does it look the quote up.
 */
export async function POST(request: Request, { params }: Params) {
  const { id } = await params;

  if (!isSameOrigin(request)) return forbiddenResponse();

  // Ahead of the id lookup, so an anonymous caller can't use the 404 to learn
  // which ids exist — the same ordering as PUT and DELETE.
  const session = await getSessionFrom(request);
  if (!session) return unauthorizedResponse();

  const quote = await getQuote(id);
  if (!quote) {
    return NextResponse.json({ error: "הציטוט לא נמצא" }, { status: 404 });
  }

  try {
    // One indexed lookup on a write path, so a reply reaches the person who
    // shared it rather than the app's own mailbox. Null is fine and common.
    const replyTo = await getUserMail(session.id);
    const result = await sendMail(
      buildQuoteEmail(quote, session.name, replyTo),
    );

    return NextResponse.json({
      sent: !result.dryRun,
      to: result.to,
      dryRun: result.dryRun,
    });
  } catch (error) {
    // The split that matters: a bad SMTP_* sends whoever investigates to
    // .env.local, an unreachable relay sends them to the mail server. Collapsing
    // the two is what made the login route blame the directory for an unset
    // SESSION_SECRET.
    if (error instanceof ConfigError) {
      console.error(`POST /api/quotes/${id}/send misconfigured`, error);
      return NextResponse.json(
        { error: "שליחת המייל לא מוגדרת בשרת" },
        { status: 500 },
      );
    }

    console.error(`POST /api/quotes/${id}/send failed`, error);
    return NextResponse.json(
      { error: "לא הצלחנו לשלוח את המייל" },
      { status: 503 },
    );
  }
}
