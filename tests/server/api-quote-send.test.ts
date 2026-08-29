import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { POST } from "@/app/api/quotes/[id]/send/route";
import { resetTransporterCache } from "@/lib/mail";
import { getDb } from "@/lib/mongodb";
import { ObjectId } from "mongodb";
import { createQuote, type QuoteActor } from "@/lib/quotes";
import type { QuoteValues } from "@/lib/quote-schema";
import { TEST_USER, sessionCookie } from "./factories";

const sendMailMock = vi.hoisted(() => vi.fn());

vi.mock("nodemailer", () => {
  const createTransport = () => ({
    sendMail: sendMailMock,
    close: vi.fn(),
  });
  return { default: { createTransport }, createTransport };
});

const ACTOR: QuoteActor = { id: TEST_USER.id, name: TEST_USER.name };

const MAIL_ENV = [
  "SMTP_HOST",
  "SMTP_PORT",
  "SMTP_SECURE",
  "SMTP_USER",
  "SMTP_PASSWORD",
  "MAIL_FROM",
  "MAIL_TO",
  "MAIL_DRY_RUN",
] as const;

let saved: Record<string, string | undefined>;

function input(overrides: Partial<QuoteValues> = {}): QuoteValues {
  return {
    text: "תמיד יש זמן לעוד קפה אחד",
    author: "דנה",
    saidAt: "2026-07-28",
    context: null,
    ...overrides,
  };
}

async function send(
  id: string,
  { cookie, origin }: { cookie?: string | null; origin?: string } = {},
) {
  const headers: Record<string, string> = { host: "localhost:3000" };
  const value = cookie === undefined ? await sessionCookie() : cookie;
  if (value) headers.cookie = value;
  if (origin) headers.origin = origin;

  return POST(
    new Request(`http://localhost:3000/api/quotes/${id}/send`, {
      method: "POST",
      headers,
    }),
    { params: Promise.resolve({ id }) },
  );
}

beforeEach(async () => {
  saved = Object.fromEntries(MAIL_ENV.map((key) => [key, process.env[key]]));

  process.env.SMTP_HOST = "relay.test.local";
  process.env.SMTP_PORT = "25";
  process.env.MAIL_FROM = "zitutim@test.local";
  process.env.MAIL_TO = "team@test.local";
  delete process.env.SMTP_SECURE;
  delete process.env.SMTP_USER;
  delete process.env.SMTP_PASSWORD;
  delete process.env.MAIL_DRY_RUN;

  sendMailMock.mockReset();
  sendMailMock.mockResolvedValue({ messageId: "<test@zitutim>" });
  resetTransporterCache();

  const db = await getDb();
  await db.collection("quotes").deleteMany({});
  await db.collection("users").deleteMany({});
});

/** The `users` row the session's `sub` points at, as a real sign-in leaves it. */
async function storeMail(mail: string) {
  const db = await getDb();
  await db
    .collection("users")
    .insertOne({ _id: new ObjectId(TEST_USER.id), mail } as never);
}

afterEach(() => {
  for (const key of MAIL_ENV) {
    if (saved[key] === undefined) delete process.env[key];
    else process.env[key] = saved[key];
  }
  resetTransporterCache();
});

describe("POST /api/quotes/[id]/send", () => {
  it("mails the quote to the configured list", async () => {
    const quote = await createQuote(input(), ACTOR);

    const response = await send(quote.id);
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      sent: true,
      to: "team@test.local",
    });

    expect(sendMailMock).toHaveBeenCalledTimes(1);
    const message = sendMailMock.mock.calls[0][0];
    expect(message.to).toBe("team@test.local");
    expect(message.from).toBe("zitutim@test.local");
    expect(message.subject).toContain("דנה");
    expect(message.attachments).toHaveLength(1);
    expect(message.attachments[0].filename).toBe("ציטוט - דנה.html");
  });

  it("points replies at the sender's stored address", async () => {
    // The route's own lookup, which the MIME tests cannot reach: they pass
    // replyTo in by hand, so nothing proved getUserMail was actually wired.
    await storeMail("dana@test.local");
    const quote = await createQuote(input(), ACTOR);

    expect((await send(quote.id)).status).toBe(200);
    expect(sendMailMock.mock.calls[0][0].replyTo).toBe("dana@test.local");
  });

  it("still sends when the stored address is not one", async () => {
    // AD's `mail` is free text. Nodemailer does not refuse a value like this,
    // it emits it — a malformed Reply-To a strict relay may bounce the message
    // over, for a reply address that could never have worked anyway.
    await storeMail("Dana Cohen");
    const quote = await createQuote(input(), ACTOR);

    expect((await send(quote.id)).status).toBe(200);
    expect(sendMailMock.mock.calls[0][0].replyTo).toBeUndefined();
  });

  it("sends with no Reply-To for someone who has never signed in", async () => {
    // The rotation editor creates a `users` row without a mail attribute.
    const quote = await createQuote(input(), ACTOR);

    expect((await send(quote.id)).status).toBe(200);
    expect(sendMailMock.mock.calls[0][0].replyTo).toBeUndefined();
  });

  it("refuses a cross-site request before anything else", async () => {
    const quote = await createQuote(input(), ACTOR);

    const response = await send(quote.id, { origin: "https://evil.example" });
    expect(response.status).toBe(403);
    expect(sendMailMock).not.toHaveBeenCalled();
  });

  it("refuses an anonymous caller", async () => {
    const quote = await createQuote(input(), ACTOR);

    const response = await send(quote.id, { cookie: null });
    expect(response.status).toBe(401);
    expect(sendMailMock).not.toHaveBeenCalled();
  });

  it("does not reveal which ids exist to an anonymous caller", async () => {
    // The 401 has to come before the lookup, or the 404/401 split is an oracle.
    const response = await send("6b0000000000000000000009", { cookie: null });
    expect(response.status).toBe(401);
  });

  it("404s for a quote that is gone", async () => {
    const response = await send("6b0000000000000000000009");
    expect(response.status).toBe(404);
    expect(sendMailMock).not.toHaveBeenCalled();
  });

  it("builds but does not send under MAIL_DRY_RUN", async () => {
    process.env.MAIL_DRY_RUN = "true";
    const quote = await createQuote(input(), ACTOR);

    const response = await send(quote.id);
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      sent: false,
      dryRun: true,
    });
    expect(sendMailMock).not.toHaveBeenCalled();
  });

  it("answers 500 for a configuration fault, not 503", async () => {
    // The distinction sends whoever investigates to .env.local rather than to
    // a mail server where nothing is wrong.
    delete process.env.SMTP_HOST;
    const quote = await createQuote(input(), ACTOR);

    const response = await send(quote.id);
    expect(response.status).toBe(500);
  });

  it("answers 503 when the relay will not take it", async () => {
    sendMailMock.mockRejectedValue(new Error("ECONNREFUSED"));
    const quote = await createQuote(input(), ACTOR);

    const response = await send(quote.id);
    expect(response.status).toBe(503);
  });
});
