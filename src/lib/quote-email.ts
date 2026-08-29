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
      `<p style="margin:0 0 20px;color:#666;font-size:14px;line-height:1.6;">${escapeHtml(
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
    <blockquote style="margin:0 0 20px;font-size:22px;font-weight:600;line-height:1.5;color:#171717;">${escapeHtml(
      quote.text,
    )}</blockquote>
    <hr style="width:48px;height:0;margin:0 auto 16px;border:0;border-top:2px solid #d62828;">
    <p style="margin:0;font-size:15px;font-weight:600;">${escapeHtml(quote.author)}</p>
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

export function buildQuoteEmail(
  quote: Quote,
  sharedBy: string,
  replyTo?: string | null,
): OutgoingMail {
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
    ...(replyTo ? { replyTo } : {}),
  };
}
