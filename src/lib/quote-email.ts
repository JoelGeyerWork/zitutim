import "server-only";

import { formatSaidAt } from "@/lib/format";
import type { OutgoingMail } from "@/lib/mail";
import {
  escapeHtml,
  quoteDocumentFilename,
  renderQuoteDocument,
} from "@/lib/quote-document";
import type { Quote } from "@/lib/quote-schema";

/**
 * Turns a quote into the message that carries it.
 *
 * The body and the attachment are deliberately different documents. The
 * attachment opens in a real browser, so it can use the inlined webfont and the
 * print stylesheet; the body is rendered by a mail client — Outlook uses Word's
 * engine — so it stays on system fonts, inline styles and block elements that
 * have worked for twenty years. Trying to make one serve both ends badly.
 */

/**
 * A header value cannot contain a line break. Nodemailer encodes the subject as
 * an RFC 2047 word, which would neutralise one anyway, but a name that arrives
 * with a newline in it is mangled input rather than a legitimate subject.
 */
function singleLine(value: string): string {
  return value.replace(/[\r\n]+/g, " ").trim();
}

/**
 * Escape, then turn the author's own newlines into `<br>`. Quotes are typed
 * into a textarea, so a multi-line one is ordinary — the wall and the printable
 * attachment both keep the breaks with `white-space: pre-wrap`. That is not an
 * option here: Word's engine ignores it the same way it ignores `max-width`,
 * and this is the part almost every client actually shows.
 */
function escapeBlock(value: string): string {
  return escapeHtml(value).replace(/\r\n|[\r\n]/g, "<br>");
}

/**
 * A pasted URL is one unbreakable word. `word-wrap` is the spelling Word's
 * engine knows; `overflow-wrap` is the one everything else does.
 */
const WRAP = "word-wrap:break-word;overflow-wrap:break-word;";

function textBody(quote: Quote, sharedBy: string): string {
  const lines = [
    `״${quote.text}״`,
    "",
    `— ${quote.author}, ${formatSaidAt(quote.saidAt)}`,
  ];
  if (quote.context) lines.push("", quote.context);
  lines.push(
    "",
    `שותף על ידי ${sharedBy} מקיר הציטוטים.`,
    "מצורף קובץ להדפסה.",
  );
  return lines.join("\n");
}

function htmlBody(quote: Quote, sharedBy: string): string {
  const context = quote.context
    ? // No rule beside it, unlike the card on the wall: the paragraph fills the
      // width while its text is centred, so any edge border detaches from the
      // words it is meant to mark.
      `<p style="margin:0 0 20px;color:#666;font-size:14px;line-height:1.6;${WRAP}">${escapeBlock(
        quote.context,
      )}</p>`
    : "";

  // Inline styles only, and no webfont: a mail client strips <style> blocks as
  // often as not, and none of them will fetch a font.
  //
  // The conditional comments are an Outlook "ghost table". Outlook for Windows
  // renders with Word's engine, which ignores `max-width` outright (2007 through
  // 2016), so without a fixed-width table the column stretches the full width of
  // whatever window it is opened in — and this team is a Windows shop. Every
  // other client skips the comments and uses the div.
  return `<div dir="rtl" lang="he" style="margin:0;padding:24px;background:#ffffff;color:#171717;font-family:'Segoe UI',Arial,Helvetica,sans-serif;">
  <!--[if mso]><table role="presentation" width="520" align="center" cellpadding="0" cellspacing="0" border="0"><tr><td dir="rtl"><![endif]-->
  <div style="max-width:520px;margin:0 auto;text-align:center;">
    <blockquote style="margin:0 0 20px;font-size:22px;font-weight:600;line-height:1.5;color:#171717;${WRAP}">${escapeBlock(
      quote.text,
    )}</blockquote>
    <hr style="width:48px;height:0;margin:0 auto 16px;border:0;border-top:2px solid #d62828;">
    <p style="margin:0;font-size:15px;font-weight:600;${WRAP}">${escapeHtml(quote.author)}</p>
    <p style="margin:4px 0 20px;font-size:13px;color:#666;">${escapeHtml(
      formatSaidAt(quote.saidAt),
    )}</p>
    ${context}
    <p style="margin:24px 0 0;font-size:12px;color:#888;">שותף על ידי ${escapeHtml(
      sharedBy,
    )} מקיר הציטוטים. מצורף קובץ להדפסה.</p>
  </div>
  <!--[if mso]></td></tr></table><![endif]-->
</div>`;
}

/**
 * AD's `mail` attribute is free text, and not everything stored there is a
 * mailbox — a display-name leftover, an Exchange `smtp:` proxy prefix, or a
 * value that arrived with a newline in it.
 *
 * Nodemailer does not reject those; it emits them. Measured, it turns
 * `smtp:dana@example` into `Reply-To: smtp:dana@example;` — RFC 5322 group
 * syntax with an empty member list — drops a bare display name silently, and
 * folds an embedded CRLF into a quoted phrase (so no header injection, but no
 * usable address either). A strict relay is entitled to refuse the message on
 * that header, and a lenient one delivers a reply address that goes nowhere.
 *
 * So anything that is not a bare `local@domain` is dropped here, leaving no
 * `Reply-To` at all — exactly the state a rotation-only user who has never
 * signed in is already in, and a state the message is designed to send in.
 */
export function replyAddress(
  mail: string | null | undefined,
): string | undefined {
  const value = mail?.trim();
  if (!value) return undefined;
  return PLAIN_ADDRESS.test(value) ? value : undefined;
}

/**
 * Deliberately stricter than RFC 5322 permits: this is a stored value we chose
 * to put in a header, not a mailbox a user typed, so the bar is "obviously a
 * plain address" rather than "arguably legal".
 */
const PLAIN_ADDRESS = /^[^\s@<>,;:"\\]+@[^\s@<>,;:"\\]+\.[^\s@<>,;:"\\]+$/;

export function buildQuoteEmail(
  quote: Quote,
  sharedBy: string,
  replyTo?: string | null,
): OutgoingMail {
  const reply = replyAddress(replyTo);

  return {
    subject: singleLine(`ציטוט מקיר הציטוטים - ${quote.author}`),
    text: textBody(quote, sharedBy),
    html: htmlBody(quote, sharedBy),
    attachments: [
      {
        filename: quoteDocumentFilename(quote),
        content: renderQuoteDocument(quote),
        contentType: "text/html; charset=utf-8",
      },
    ],
    ...(reply ? { replyTo: reply } : {}),
  };
}
