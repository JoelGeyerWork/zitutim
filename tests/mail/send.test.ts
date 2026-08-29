import { createConnection } from "node:net";
import { beforeAll, describe, expect, it } from "vitest";

import { resetTransporterCache, sendMail } from "@/lib/mail";
import { buildQuoteEmail } from "@/lib/quote-email";
import type { Quote } from "@/lib/quote-schema";

/**
 * Exercises `sendMail` against the real Mailpit from docker-compose.mail.yml —
 * a real SMTP conversation, and assertions on what actually arrived rather than
 * on what we handed to a mock. `tests/server/quote-email.test.ts` covers the
 * MIME encoding without a server; this covers the wire.
 *
 * Start it with `npm run mail:up`; without it every test here skips. The
 * delivered mail is also visible at http://localhost:8025, which is the fastest
 * way to see what a change actually looks like in a client.
 */
const HOST = "localhost";
const SMTP_PORT = 1025;
const API = "http://localhost:8025/api/v1";

function reachable(): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = createConnection({ host: HOST, port: SMTP_PORT });
    const settle = (value: boolean) => {
      socket.destroy();
      resolve(value);
    };
    socket.setTimeout(1500);
    socket.once("connect", () => settle(true));
    socket.once("timeout", () => settle(false));
    socket.once("error", () => settle(false));
  });
}

// At module scope, not in beforeAll: `describe.skipIf` is evaluated while tests
// are being collected, which happens first.
const up = await reachable();

if (up) {
  process.env.SMTP_HOST = HOST;
  process.env.SMTP_PORT = String(SMTP_PORT);
  process.env.SMTP_SECURE = "false";
  process.env.MAIL_FROM = "zitutim@test.local";
  process.env.MAIL_TO = "team@test.local";
  delete process.env.SMTP_USER;
  delete process.env.SMTP_PASSWORD;
  delete process.env.MAIL_DRY_RUN;
}

function makeQuote(overrides: Partial<Quote> = {}): Quote {
  return {
    id: "6b0000000000000000000001",
    text: "תמיד יש זמן לעוד קפה אחד",
    author: "דנה",
    saidAt: "2026-07-28T00:00:00.000Z",
    context: "לפני הריטרו",
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

interface MailpitSummary {
  ID: string;
  Subject: string;
}

async function latestMessage() {
  const list = await fetch(`${API}/messages?limit=1`);
  const { messages } = (await list.json()) as {
    messages: MailpitSummary[];
  };
  expect(messages.length).toBeGreaterThan(0);

  const full = await fetch(`${API}/message/${messages[0].ID}`);
  return (await full.json()) as {
    Subject: string;
    HTML: string;
    Text: string;
    To: { Address: string }[];
    From: { Address: string };
    ReplyTo: { Address: string }[] | null;
    Attachments: { FileName: string; ContentType: string; PartID: string }[];
  };
}

describe.skipIf(!up)("sendMail against a real relay", () => {
  beforeAll(async () => {
    resetTransporterCache();
    await fetch(`${API}/messages`, { method: "DELETE" });
  });

  it("delivers the quote with its attachment intact", async () => {
    const result = await sendMail(
      buildQuoteEmail(makeQuote(), "יואל", "yoel@test.local"),
    );
    expect(result.dryRun).toBe(false);
    expect(result.messageId).toBeTruthy();

    const message = await latestMessage();

    expect(message.Subject).toBe("ציטוט מקיר הציטוטים - דנה");
    expect(message.From.Address).toBe("zitutim@test.local");
    expect(message.To[0].Address).toBe("team@test.local");
    expect(message.ReplyTo?.[0].Address).toBe("yoel@test.local");

    expect(message.HTML).toContain("תמיד יש זמן לעוד קפה אחד");
    expect(message.HTML).toContain("לפני הריטרו");
    expect(message.Text).toContain("דנה");

    expect(message.Attachments).toHaveLength(1);
    expect(message.Attachments[0].FileName).toBe("ציטוט - דנה.html");
    expect(message.Attachments[0].ContentType).toBe("text/html");
  });

  it("delivers an attachment a browser can still open", async () => {
    await sendMail(buildQuoteEmail(makeQuote(), "יואל"));
    const message = await latestMessage();

    const part = message.Attachments[0].PartID;
    const raw = await fetch(
      `${API}/message/${(await listLatestId())}/part/${part}`,
    );
    const html = await raw.text();

    // The whole point of the attachment: a standalone document with its font
    // inlined, which has survived base64 transport unchanged.
    expect(html.startsWith("<!doctype html>")).toBe(true);
    expect(html).toContain("@font-face");
    expect(html).toContain("url(data:font/woff2;base64,");
    expect(html).toContain("תמיד יש זמן לעוד קפה אחד");
  });
});

async function listLatestId(): Promise<string> {
  const list = await fetch(`${API}/messages?limit=1`);
  const { messages } = (await list.json()) as { messages: { ID: string }[] };
  return messages[0].ID;
}
