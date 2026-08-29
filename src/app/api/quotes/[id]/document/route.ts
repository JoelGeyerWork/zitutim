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
      // The wall is editable, so a cached copy would hand back stale text.
      "Cache-Control": "no-store",
    },
  });
}
