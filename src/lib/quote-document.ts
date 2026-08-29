import "server-only";

import {
  HEEBO_HEBREW_WOFF2_BASE64,
  HEEBO_LATIN_WOFF2_BASE64,
} from "@/lib/fonts/heebo-embedded";
import { formatSaidAt } from "@/lib/format";
import type { Quote } from "@/lib/quote-schema";

/**
 * Builds the standalone printable page for a single quote — a whole HTML
 * document as a string, with no external references of any kind.
 *
 * The browser that opens the file does the bidi reordering, the line breaking
 * and the font fallback, which is the entire reason this is HTML and not a PDF
 * we lay out ourselves: no JS PDF library implements the Unicode Bidirectional
 * Algorithm, so mixed Hebrew/Latin/digit lines would come out scrambled.
 *
 * Server-side only — not for the usual Mongo reason, but because it inlines
 * the font, which has no business in the browser bundle. The transitive
 * `server-only` comes from `@/lib/fonts/heebo-embedded`.
 *
 * There is no script here, not even an inline `onclick`, and that is a rule
 * rather than an omission. The same string is served as `text/html` from the
 * app's own origin, so any escaping that ever slips becomes stored XSS against
 * a real session — a document that has already opted into script is one where
 * that lands. It is also why a Windows mail gateway eats an `.html` attachment,
 * which would drop the printable file while the mail itself sailed through.
 * The print stylesheet does the work; the keyboard does the rest.
 */

/**
 * Google's own subset ranges. Without them the browser cannot tell which of the
 * two faces owns a given character and simply uses the last one declared, so
 * every Hebrew letter would fall back.
 */
const HEBREW_RANGE =
  "U+0307-0308,U+0590-05FF,U+200C-2010,U+20AA,U+25CC,U+FB1D-FB4F";
const LATIN_RANGE =
  "U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304," +
  "U+0308,U+0329,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215," +
  "U+FEFF,U+FFFD";

/** One `@font-face` per subset, both pointing at an inlined data: URI. */
function fontFace(base64: string, unicodeRange: string): string {
  return `  @font-face {
    font-family: "Heebo";
    font-style: normal;
    /* Heebo is variable, so this single file serves every weight below. */
    font-weight: 100 900;
    font-display: block;
    src: url(data:font/woff2;base64,${base64}) format("woff2");
    unicode-range: ${unicodeRange};
  }`;
}

/** `&` first, or the entities this introduces get escaped a second time. */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * Quotes run to 2000 characters, and one size can't serve both ends of that.
 * Chosen from the length rather than fitted at render time so the output is
 * deterministic — the file has to look the same wherever it is opened.
 */
function sizeClass(length: number): "lg" | "md" | "sm" {
  if (length <= 120) return "lg";
  if (length <= 400) return "md";
  return "sm";
}

export function quoteDocumentTitle(quote: Quote): string {
  return `ציטוט - ${quote.author}`;
}

/**
 * The path separators and the characters Windows refuses, plus the control
 * range — `author` is user input, and a CR or LF would go on to break whichever
 * header carries the name, in a response or in a MIME part alike. Deliberately
 * narrow: a dash or an apostrophe is perfectly legal and belongs in the name.
 */
const UNSAFE_IN_FILENAME = /[\u0000-\u001f\u007f/\\:*?"<>|]+/g;

/** Shared by the download route and the email attachment, so they agree. */
export function quoteDocumentFilename(quote: Quote): string {
  const clean = quoteDocumentTitle(quote)
    .replace(UNSAFE_IN_FILENAME, " ")
    .trim();
  return `${clean || "quote"}.html`;
}

export function renderQuoteDocument(quote: Quote): string {
  const title = escapeHtml(quoteDocumentTitle(quote));
  const text = escapeHtml(quote.text);
  const author = escapeHtml(quote.author);
  const saidAt = escapeHtml(formatSaidAt(quote.saidAt));
  const context = quote.context ? escapeHtml(quote.context) : null;

  return `<!doctype html>
<html lang="he" dir="rtl">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title>
<style>
${fontFace(HEEBO_HEBREW_WOFF2_BASE64, HEBREW_RANGE)}

${fontFace(HEEBO_LATIN_WOFF2_BASE64, LATIN_RANGE)}

  /* Print backgrounds default to off in every browser, so the design carries
     on type, rules and whitespace only — never a filled shape. */
  @page { size: A4; margin: 22mm; }

  :root {
    --ink: #171717;
    --muted: #666;
    --accent: #d62828;
  }

  * { box-sizing: border-box; }

  html { height: 100%; }

  body {
    /* min-height, not height: a 2000-character quote has to be free to grow
       past the page rather than be centred and clipped. */
    min-height: 100%;
    margin: 0;
    padding: 24mm 18mm;
    display: flex;
    flex-direction: column;
    justify-content: center;
    align-items: center;
    text-align: center;
    color: var(--ink);
    background: #fff;
    font-family: "Heebo", "Arial Hebrew", "Noto Sans Hebrew", "Segoe UI",
      Arial, sans-serif;
    -webkit-font-smoothing: antialiased;
    text-rendering: optimizeLegibility;
  }

  .quote {
    margin: 0 auto;
    max-width: 34rem;
    /* 500 rather than 600: at display sizes the heavier weight reads as shouty,
       and the variable font gives us the intermediate step for free. */
    font-weight: 500;
    line-height: 1.5;
    text-wrap: balance;
    /* The wall preserves the author's own line breaks; so does this. */
    white-space: pre-wrap;
    /* A pasted URL is one unbreakable word, and without this it runs off the
       side of the sheet — where, unlike on screen, it cannot be scrolled to. */
    overflow-wrap: break-word;
  }

  /* Large type needs a touch of negative tracking to stop it looking loose. */
  .quote.lg { font-size: 2.15rem; letter-spacing: -0.015em; }
  .quote.md { font-size: 1.5rem; }
  .quote.sm { font-size: 1.1rem; line-height: 1.65; }

  .rule {
    width: 3rem;
    height: 0;
    margin: 2rem auto 1.5rem;
    border: 0;
    border-top: 2px solid var(--accent);
  }

  .author { margin: 0; font-size: 1.05rem; font-weight: 600; }

  .said-at { margin: 0.35rem 0 0; font-size: 0.9rem; color: var(--muted); }

  .context {
    margin: 2rem auto 0;
    max-width: 26rem;
    font-size: 0.85rem;
    line-height: 1.6;
    color: var(--muted);
    overflow-wrap: break-word;
  }

  /* A hint, not a control: see the note on the element itself. */
  .print-hint {
    position: fixed;
    inset-block-start: 1rem;
    inset-inline-end: 1rem;
    margin: 0;
    font-size: 0.8rem;
    color: var(--muted);
  }

  @media print {
    body { padding: 0; }
    .print-hint { display: none; }
  }
</style>
</head>
<body>
<p class="print-hint">Ctrl+P / ⌘P להדפסה</p>
<main>
  <blockquote class="quote ${sizeClass(quote.text.length)}">${text}</blockquote>
  <hr class="rule">
  <p class="author">${author}</p>
  <p class="said-at">${saidAt}</p>
${context ? `  <p class="context">${context}</p>\n` : ""}</main>
</body>
</html>
`;
}
