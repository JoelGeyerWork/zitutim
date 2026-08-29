import "server-only";

import nodemailer, { type Transporter } from "nodemailer";

import { ConfigError } from "@/lib/config-error";

/**
 * The SMTP layer: one relay, read lazily, with configuration faults kept
 * distinguishable from the relay being down — the same split `ldap.ts` makes,
 * for the same reason. A `ConfigError` sends whoever investigates to
 * `.env.local`; anything else sends them to the mail server.
 */

export interface MailSettings {
  host: string;
  port: number;
  secure: boolean;
  user: string | undefined;
  password: string | undefined;
  from: string;
  to: string;
  /**
   * Skips verification of the relay's certificate. The connection stays
   * encrypted — what it drops is proving which server is on the other end.
   */
  tlsInsecure: boolean;
  /** Builds and logs the message without handing it to the relay. */
  dryRun: boolean;
}

/** So the insecure-TLS warning is logged once, not on every send. */
let warnedInsecure = false;

/**
 * Read lazily, like `config()` in ldap.ts and `getClient()` in mongodb.ts — the
 * test suite sets these in `beforeAll`, after imports have already run.
 */
export function mailSettings(): MailSettings {
  const host = process.env.SMTP_HOST;
  const from = process.env.MAIL_FROM;
  const to = process.env.MAIL_TO;

  if (!host || !from || !to) {
    throw new ConfigError(
      "SMTP_HOST, MAIL_FROM and MAIL_TO must be set. Copy .env.example to .env.local and fill them in.",
    );
  }

  const rawPort = process.env.SMTP_PORT?.trim();
  const port = rawPort ? Number(rawPort) : 25;
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new ConfigError(`SMTP_PORT must be a port number, not "${rawPort}".`);
  }

  const user = process.env.SMTP_USER?.trim() || undefined;
  const password = process.env.SMTP_PASSWORD || undefined;

  // A username with no password would authenticate as nobody and the relay
  // would either refuse it or, worse, accept it as anonymous — the same shape
  // of trap as an empty LDAP bind password.
  if (user && !password) {
    throw new ConfigError(
      "SMTP_USER is set but SMTP_PASSWORD is not. Set both, or neither for an unauthenticated relay.",
    );
  }

  // The mirror image, and the likelier mistake when the password is an API key:
  // AUTH PLAIN/LOGIN always carries a username, so a key on its own cannot be
  // sent. Without this the transport would quietly drop `auth` altogether and
  // the relay would reject a message that looks fully configured.
  if (password && !user) {
    throw new ConfigError(
      'SMTP_PASSWORD is set but SMTP_USER is not. SMTP authentication always needs a username — an API key usually pairs with a fixed one (SendGrid uses the literal "apikey").',
    );
  }

  // Turns off verification of the relay's certificate. The connection is still
  // encrypted, so passive sniffing is still off the table; what it gives up is
  // *authenticating* the server, which opens the door to an active MITM
  // collecting whatever SMTP_PASSWORD holds — an API key included. Accepted
  // here on the same grounds as LDAP_TLS_INSECURE, that the network is
  // air-gapped. On anything routable, point NODE_EXTRA_CA_CERTS at the issuing
  // CA instead; that needs no code and keeps verification on.
  //
  // Note this is *not* nodemailer's `ignoreTLS`, which skips STARTTLS entirely
  // and would put the credential on the wire in clear text.
  const tlsInsecure = process.env.SMTP_TLS_INSECURE === "true";

  if (tlsInsecure && !warnedInsecure) {
    warnedInsecure = true;
    console.warn(
      "SMTP_TLS_INSECURE=true — the mail relay's certificate is not being verified.",
    );
  }

  return {
    host,
    port,
    // Implicit TLS is 465; 25 and 587 upgrade with STARTTLS when offered.
    secure: process.env.SMTP_SECURE === "true",
    user,
    password,
    from,
    to,
    tlsInsecure,
    dryRun: process.env.MAIL_DRY_RUN === "true",
  };
}

/**
 * Force the lazy read, for `instrumentation.ts`. Touches no socket — it only
 * proves the variables parse, which is the half of "can anyone send?" that is
 * knowable at boot.
 */
export function assertMailConfigured(): void {
  mailSettings();
}

let transporter: Transporter | undefined;
let transporterKey: string | undefined;

/**
 * One pooled transport per configuration. Pooled because the alternative is a
 * fresh TCP and TLS handshake per send, and keyed on the settings so a test
 * that changes the environment isn't served a transport built from the old one.
 */
function getTransporter(settings: MailSettings): Transporter {
  const key = JSON.stringify([
    settings.host,
    settings.port,
    settings.secure,
    settings.user,
    settings.tlsInsecure,
  ]);

  if (!transporter || transporterKey !== key) {
    transporter = nodemailer.createTransport({
      host: settings.host,
      port: settings.port,
      secure: settings.secure,
      pool: true,
      auth: settings.user
        ? { user: settings.user, pass: settings.password }
        : undefined,
      ...(settings.tlsInsecure ? { tls: { rejectUnauthorized: false } } : {}),
    });
    transporterKey = key;
  }

  return transporter;
}

/** For tests, which swap the environment between cases. */
export function resetTransporterCache(): void {
  transporter?.close();
  transporter = undefined;
  transporterKey = undefined;
}

export interface Attachment {
  filename: string;
  content: string;
  contentType: string;
}

export interface OutgoingMail {
  subject: string;
  html: string;
  text: string;
  attachments: Attachment[];
  /** So a reply reaches whoever shared it, rather than the app's own mailbox. */
  replyTo?: string;
}

export interface SendResult {
  messageId: string | null;
  dryRun: boolean;
  to: string;
}

/**
 * Hands the message to the relay. Throws `ConfigError` for a deployment fault
 * and anything else for a relay that would not take it, so the route can map
 * the two to 500 and 503 rather than collapsing them into one message.
 */
export async function sendMail(mail: OutgoingMail): Promise<SendResult> {
  const settings = mailSettings();

  if (settings.dryRun) {
    // The escape hatch for the first send against a real relay, where the
    // recipient is a whole team's mailing list and a mistake is public.
    console.info(
      `MAIL_DRY_RUN: would send "${mail.subject}" to ${settings.to} with ${mail.attachments.length} attachment(s)`,
    );
    return { messageId: null, dryRun: true, to: settings.to };
  }

  const info = await getTransporter(settings).sendMail({
    from: settings.from,
    to: settings.to,
    replyTo: mail.replyTo,
    subject: mail.subject,
    text: mail.text,
    html: mail.html,
    attachments: mail.attachments,
  });

  return { messageId: info.messageId ?? null, dryRun: false, to: settings.to };
}
