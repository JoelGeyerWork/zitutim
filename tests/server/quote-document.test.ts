import { describe, expect, it } from "vitest";

import { quoteDocumentTitle, renderQuoteDocument } from "@/lib/quote-document";
import type { Quote } from "@/lib/quote-schema";

function makeQuote(overrides: Partial<Quote> = {}): Quote {
  return {
    id: "6b0000000000000000000001",
    text: "תמיד יש זמן לעוד קפה אחד",
    author: "דנה",
    authorId: null,
    saidAt: "2026-07-28T00:00:00.000Z",
    context: null,
    addedBy: "יואל",
    addedById: "6b0000000000000000000002",
    updatedBy: null,
    updatedById: null,
    createdAt: "2026-07-29T09:00:00.000Z",
    updatedAt: "2026-07-29T09:00:00.000Z",
    likeCount: 0,
    commentCount: 0,
    likedByViewer: false,
    commentsPreview: [],
    ...overrides,
  };
}

describe("renderQuoteDocument", () => {
  it("is a standalone RTL Hebrew document", () => {
    const html = renderQuoteDocument(makeQuote());

    expect(html.startsWith("<!doctype html>")).toBe(true);
    expect(html).toContain('<html lang="he" dir="rtl">');
    expect(html).toContain('<meta charset="utf-8">');
  });

  it("references nothing outside itself, so it prints offline", () => {
    const html = renderQuoteDocument(makeQuote({ context: "לפני הריטרו" }));

    // No stylesheet, script src, image or font fetch of any kind: the file is
    // opened from disk, very possibly on a machine with no network at all.
    expect(html).not.toMatch(/<link\b/i);
    expect(html).not.toMatch(/<script\b/i);
    expect(html).not.toMatch(/\bsrc=/i);
    expect(html).not.toMatch(/https?:\/\//i);
  });

  it("inlines Heebo for both scripts, with a range each", () => {
    const html = renderQuoteDocument(makeQuote());

    const faces = html.match(/@font-face/g) ?? [];
    expect(faces).toHaveLength(2);
    expect(html).toContain("url(data:font/woff2;base64,");
    // Without a unicode-range per subset the browser cannot tell the two faces
    // apart and uses whichever was declared last, losing one script entirely.
    expect(html).toContain("U+0590-05FF");
    expect(html).toContain("U+0000-00FF");
    // Variable font: one file has to answer for every weight the page asks for.
    expect(html).toContain("font-weight: 100 900");
  });

  it("carries the quote, the author and the date formatted in UTC", () => {
    const html = renderQuoteDocument(makeQuote());

    expect(html).toContain("תמיד יש זמן לעוד קפה אחד");
    expect(html).toContain("דנה");
    // saidAt is stored at UTC midnight; formatting it locally would render the
    // 27th anywhere west of Greenwich.
    expect(html).toContain("28 ביולי 2026");
  });

  it("includes the context only when there is one", () => {
    // The stylesheet always carries a .context rule, so assert on the element.
    expect(renderQuoteDocument(makeQuote())).not.toContain(
      '<p class="context">',
    );
    expect(
      renderQuoteDocument(makeQuote({ context: "לפני הריטרו" })),
    ).toContain("לפני הריטרו");
  });

  it("escapes HTML in every field the user controls", () => {
    const html = renderQuoteDocument(
      makeQuote({
        text: "<script>alert('x')</script>",
        author: 'דנה & "המנהלת"',
        context: "<img onerror=alert(1)>",
      }),
    );

    expect(html).not.toContain("<script>alert");
    expect(html).not.toContain("<img onerror");
    expect(html).toContain("&lt;script&gt;");
    expect(html).toContain("&amp;");
    expect(html).toContain("&quot;");
  });

  it("escapes the ampersand first, so entities are not double-escaped", () => {
    const html = renderQuoteDocument(makeQuote({ text: "&lt;" }));

    // The literal text "&lt;" must survive as "&amp;lt;" — reading back as
    // "&lt;" — rather than collapsing into a "<".
    expect(html).toContain("&amp;lt;");
  });

  it("scales the type down as the quote gets longer", () => {
    const short = renderQuoteDocument(makeQuote({ text: "קצר" }));
    const medium = renderQuoteDocument(makeQuote({ text: "א".repeat(300) }));
    const long = renderQuoteDocument(makeQuote({ text: "א".repeat(1200) }));

    expect(short).toContain('class="quote lg"');
    expect(medium).toContain('class="quote md"');
    expect(long).toContain('class="quote sm"');
  });

  it("keeps the author's own line breaks", () => {
    const html = renderQuoteDocument(makeQuote({ text: "שורה\nשנייה" }));

    expect(html).toContain("white-space: pre-wrap");
    expect(html).toContain("שורה\nשנייה");
  });

  it("breaks an unbreakable word rather than running off the sheet", () => {
    // A pasted URL is a single word. On screen the overflow can be scrolled to;
    // on paper it is simply gone.
    const html = renderQuoteDocument(makeQuote());

    expect(html).toMatch(/\.quote \{[^}]*overflow-wrap: break-word;/);
    expect(html).toMatch(/\.context \{[^}]*overflow-wrap: break-word;/);
  });

  it("carries no script at all, not even an inline handler", () => {
    const html = renderQuoteDocument(makeQuote());

    // The same string is served as text/html from the app's own origin, so a
    // document that has opted into script is a document where a missed escape
    // runs with the session cookie in reach. It is also the handler a Windows
    // mail gateway strips the whole attachment for. The print stylesheet does
    // the work; the keyboard does the rest.
    //
    // Matched against the markup only: the quote body legitimately contains
    // whatever someone typed, escaped, so `onerror=` as *text* is not a finding.
    const markup = html.replace(/&[a-z]+;|&#\d+;/g, "");
    expect(markup).not.toMatch(/<script\b/i);
    expect(markup).not.toMatch(/\son[a-z]+\s*=/i);
    expect(markup).not.toContain("window.print()");
  });

  it("hides the print hint when printing", () => {
    const html = renderQuoteDocument(makeQuote());

    expect(html).toContain("print-hint");
    expect(html).toMatch(
      /@media print[\s\S]*\.print-hint \{ display: none; \}/,
    );
  });
});

describe("quoteDocumentTitle", () => {
  it("names the quote after whoever said it", () => {
    expect(quoteDocumentTitle(makeQuote())).toBe("ציטוט - דנה");
  });
});
