import { NextResponse } from "next/server";

import {
  quoteDocumentFilename,
  renderQuoteDocument,
} from "@/lib/quote-document";
import { getQuote } from "@/lib/quotes";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

/**
 * RFC 5987 leaves `'`, `(`, `)` and `*` out of attr-char, and
 * `encodeURIComponent` doesn't touch them — so they need encoding by hand or
 * the parameter is malformed.
 */
function encodeRfc5987(value: string): string {
  return encodeURIComponent(value).replace(
    /['()*]/g,
    (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}

function contentDisposition(filename: string): string {
  // The ASCII fallback is a constant rather than a transliteration: it is the
  // half a naive parser reads, so nothing user-supplied belongs in it.
  return `attachment; filename="quote.html"; filename*=UTF-8''${encodeRfc5987(filename)}`;
}

/**
 * The document is entirely self-contained, so it can be locked down to exactly
 * what it uses: inline CSS, and a font and nothing else from `data:`. Script is
 * refused outright.
 *
 * Defence in depth rather than the fix — `renderQuoteDocument` emits no script
 * and escapes every user field. This is the net under that: an escaping bug
 * here would otherwise run as first-party HTML on the app's own origin, with
 * the session cookie in reach. `Content-Disposition: attachment` is not the
 * guard people take it for, since "open in new tab" and iOS Safari both ignore
 * it. Note it protects the served copy only — a saved file opens from `file://`
 * with no CSP at all, which is why the document carries no script to begin with.
 */
const CSP = [
  "default-src 'none'",
  "style-src 'unsafe-inline'",
  "font-src data:",
  "img-src data:",
  "base-uri 'none'",
  "form-action 'none'",
  // An opaque origin on top, so even a missed escape could not reach the
  // session cookie. The document is inert — there is nothing here for the
  // sandbox to cost, and the browser's own print command is unaffected.
  "sandbox",
].join("; ");

/** Public, like every other GET here — reading the wall needs no session. */
export async function GET(_request: Request, { params }: Params) {
  const { id } = await params;

  const quote = await getQuote(id);
  if (!quote) {
    return NextResponse.json({ error: "הציטוט לא נמצא" }, { status: 404 });
  }

  return new NextResponse(renderQuoteDocument(quote), {
    status: 200,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Content-Disposition": contentDisposition(quoteDocumentFilename(quote)),
      "Content-Security-Policy": CSP,
      // The wall is editable, so a cached copy would hand back stale text.
      "Cache-Control": "no-store",
    },
  });
}
