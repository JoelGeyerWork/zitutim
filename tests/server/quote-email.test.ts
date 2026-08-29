import { simpleParser } from "mailparser";
import nodemailer from "nodemailer";
import { describe, expect, it } from "vitest";

import { buildQuoteEmail } from "@/lib/quote-email";
import type { Quote } from "@/lib/quote-schema";

/**
 * These build the real RFC 822 bytes and parse them back, rather than asserting
 * on the object handed to a mock. Everything that goes wrong with Hebrew mail
 * goes wrong in that serialization — the subject needs RFC 2047 encoded-words
 * and the attachment filename needs RFC 2231 — and a mock would happily report
 * success while the wire format was unreadable.
 */
async function roundTrip(mail: ReturnType<typeof buildQuoteEmail>) {
  const transport = nodemailer.createTransport({
    streamTransport: true,
    buffer: true,
  });

  const info = await transport.sendMail({
    from: "zitutim@test.local",
    to: "team@test.local",
    subject: mail.subject,
    text: mail.text,
    html: mail.html,
    attachments: mail.attachments,
    ...(mail.replyTo ? { replyTo: mail.replyTo } : {}),
  });

  return simpleParser(info.message as Buffer);
}

function makeQuote(overrides: Partial<Quote> = {}): Quote {
  return {
    id: "6b0000000000000000000001",
    text: "תמיד יש זמן לעוד קפה אחד",
    author: "דנה",
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

describe("buildQuoteEmail", () => {
  it("survives serialization with its Hebrew subject intact", async () => {
    const parsed = await roundTrip(buildQuoteEmail(makeQuote(), "יואל"));

    expect(parsed.subject).toBe("ציטוט מקיר הציטוטים - דנה");
  });

  it("attaches the printable document under a readable Hebrew filename", async () => {
    const parsed = await roundTrip(buildQuoteEmail(makeQuote(), "יואל"));

    expect(parsed.attachments).toHaveLength(1);
    const [attachment] = parsed.attachments;

    expect(attachment.filename).toBe("ציטוט - דנה.html");
    expect(attachment.contentType).toBe("text/html");

    const content = attachment.content.toString("utf8");
    expect(content.startsWith("<!doctype html>")).toBe(true);
    expect(content).toContain("תמיד יש זמן לעוד קפה אחד");
    // The attachment is the one that gets the webfont; the body must not.
    expect(content).toContain("@font-face");
  });

  it("sends an RTL HTML body that needs no external anything", async () => {
    const parsed = await roundTrip(
      buildQuoteEmail(makeQuote({ context: "לפני הריטרו" }), "יואל"),
    );

    const html = parsed.html as string;
    expect(html).toContain('dir="rtl"');
    expect(html).toContain("תמיד יש זמן לעוד קפה אחד");
    expect(html).toContain("לפני הריטרו");
    expect(html).toContain("יואל");

    // No webfont in the body: mail clients don't fetch one, and Outlook renders
    // with Word's engine. The body stays on system fonts and inline styles.
    expect(html).not.toContain("@font-face");
    expect(html).not.toMatch(/<link\b/i);
    expect(html).not.toMatch(/https?:\/\//i);
  });

  it("wraps the body in an Outlook ghost table", async () => {
    const parsed = await roundTrip(buildQuoteEmail(makeQuote(), "יואל"));
    const html = parsed.html as string;

    // Outlook for Windows renders with Word's engine and ignores max-width
    // (2007-2016), so without the fixed-width table the column stretches to the
    // full width of the window. Both halves are needed or the markup is broken.
    expect(html).toContain("<!--[if mso]>");
    expect(html).toContain('width="520"');
    expect(html).toContain("<![endif]-->");
    expect(html.match(/<!--\[if mso\]>/g)).toHaveLength(2);
  });

  it("offers a plain-text alternative", async () => {
    const parsed = await roundTrip(buildQuoteEmail(makeQuote(), "יואל"));

    expect(parsed.text).toContain("תמיד יש זמן לעוד קפה אחד");
    expect(parsed.text).toContain("דנה");
    expect(parsed.text).toContain("יואל");
  });

  it("points replies at whoever shared it, when their address is known", async () => {
    const withAddress = await roundTrip(
      buildQuoteEmail(makeQuote(), "יואל", "yoel@test.local"),
    );
    expect(withAddress.replyTo?.text).toContain("yoel@test.local");

    // Null is ordinary: nobody who has only ever been added to the rotation has
    // a stored address, and the message must still be sendable.
    const without = await roundTrip(buildQuoteEmail(makeQuote(), "יואל", null));
    expect(without.replyTo).toBeUndefined();
  });

  it("escapes HTML in the body, not just in the attachment", async () => {
    const parsed = await roundTrip(
      buildQuoteEmail(
        makeQuote({ text: "<script>alert('x')</script>" }),
        "<b>יואל</b>",
      ),
    );

    const html = parsed.html as string;
    expect(html).not.toContain("<script>alert");
    expect(html).not.toContain("<b>יואל</b>");
    expect(html).toContain("&lt;script&gt;");
  });

  it("keeps a mangled author name from breaking the subject header", async () => {
    const parsed = await roundTrip(
      buildQuoteEmail(makeQuote({ author: "דנה\r\nX-Injected: yes" }), "יואל"),
    );

    expect(parsed.subject).not.toMatch(/[\r\n]/);
    expect(parsed.headers.has("x-injected")).toBe(false);
  });
});
