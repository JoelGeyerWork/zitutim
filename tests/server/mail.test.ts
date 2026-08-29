import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ConfigError } from "@/lib/config-error";
import {
  assertMailConfigured,
  mailSettings,
  resetTransporterCache,
  sendMail,
} from "@/lib/mail";

const createTransport = vi.hoisted(() => vi.fn());
const sendMailMock = vi.hoisted(() => vi.fn());

vi.mock("nodemailer", () => {
  const factory = (options: unknown) => {
    createTransport(options);
    return { sendMail: sendMailMock, close: vi.fn() };
  };
  return { default: { createTransport: factory }, createTransport: factory };
});

const MAIL_ENV = [
  "SMTP_HOST",
  "SMTP_PORT",
  "SMTP_SECURE",
  "SMTP_USER",
  "SMTP_PASSWORD",
  "MAIL_FROM",
  "MAIL_TO",
  "MAIL_DRY_RUN",
  "SMTP_TLS_INSECURE",
] as const;

let saved: Record<string, string | undefined>;

beforeEach(() => {
  saved = Object.fromEntries(MAIL_ENV.map((key) => [key, process.env[key]]));
  for (const key of MAIL_ENV) delete process.env[key];

  process.env.SMTP_HOST = "relay.test.local";
  process.env.MAIL_FROM = "zitutim@test.local";
  process.env.MAIL_TO = "team@test.local";

  createTransport.mockClear();
  sendMailMock.mockReset();
  sendMailMock.mockResolvedValue({ messageId: "<test@zitutim>" });
  resetTransporterCache();
});

afterEach(() => {
  resetTransporterCache();
  for (const key of MAIL_ENV) {
    if (saved[key] === undefined) delete process.env[key];
    else process.env[key] = saved[key];
  }
});

describe("mailSettings", () => {
  it("defaults the port to 25 and stays insecure unless asked", () => {
    const settings = mailSettings();

    expect(settings.port).toBe(25);
    expect(settings.secure).toBe(false);
    expect(settings.dryRun).toBe(false);
    expect(settings.user).toBeUndefined();
  });

  it("reads the environment lazily, not at import time", () => {
    // The whole reason for the getter: vitest sets env after imports have run,
    // so a module-scope read would have captured undefined.
    process.env.MAIL_TO = "someone-else@test.local";
    expect(mailSettings().to).toBe("someone-else@test.local");
  });

  it.each(["SMTP_HOST", "MAIL_FROM", "MAIL_TO"])(
    "refuses to run without %s",
    (key) => {
      delete process.env[key];
      expect(() => mailSettings()).toThrow(ConfigError);
    },
  );

  it.each(["0", "70000", "-1", "smtp", "25.5"])(
    "rejects %s as a port",
    (value) => {
      process.env.SMTP_PORT = value;
      expect(() => mailSettings()).toThrow(ConfigError);
    },
  );

  it("accepts a username only when a password comes with it", () => {
    process.env.SMTP_USER = "zitutim";

    // A username with no password authenticates as nobody: the relay either
    // refuses it or, worse, accepts it as anonymous. The same trap as an empty
    // LDAP bind password, and refused for the same reason.
    expect(() => mailSettings()).toThrow(ConfigError);

    process.env.SMTP_PASSWORD = "relay-password";
    expect(mailSettings().user).toBe("zitutim");
  });

  it("refuses an API key with no username to send it under", () => {
    // The likelier half of the pair to get wrong: the key goes in
    // SMTP_PASSWORD and SMTP_USER is left blank, at which point the transport
    // would drop auth entirely and the relay would reject a config that looks
    // complete. AUTH PLAIN/LOGIN always carries a username.
    process.env.SMTP_PASSWORD = "SG.a-real-looking-api-key";

    expect(() => mailSettings()).toThrow(ConfigError);

    process.env.SMTP_USER = "apikey";
    expect(mailSettings().password).toBe("SG.a-real-looking-api-key");
  });

  it("allows neither, for a relay that takes unauthenticated internal mail", () => {
    expect(() => mailSettings()).not.toThrow();
  });

  it("verifies the relay's certificate unless told not to", () => {
    expect(mailSettings().tlsInsecure).toBe(false);

    // Opt-in on the exact string, like LDAP_TLS_INSECURE and SMTP_SECURE: a
    // typo must fail closed, leaving verification on.
    process.env.SMTP_TLS_INSECURE = "yes";
    expect(mailSettings().tlsInsecure).toBe(false);

    process.env.SMTP_TLS_INSECURE = "true";
    expect(mailSettings().tlsInsecure).toBe(true);
  });

  it("treats MAIL_DRY_RUN as opt-in", () => {
    process.env.MAIL_DRY_RUN = "yes";
    expect(mailSettings().dryRun).toBe(false);

    process.env.MAIL_DRY_RUN = "true";
    expect(mailSettings().dryRun).toBe(true);
  });
});

describe("assertMailConfigured", () => {
  it("forces the lazy read so instrumentation can report at boot", () => {
    expect(() => assertMailConfigured()).not.toThrow();

    delete process.env.SMTP_HOST;
    expect(() => assertMailConfigured()).toThrow(ConfigError);
  });
});

const MESSAGE = {
  subject: "נושא",
  html: "<p>גוף</p>",
  text: "גוף",
  attachments: [],
};

describe("the transport SMTP_TLS_INSECURE builds", () => {
  it("verifies the certificate by default", async () => {
    await sendMail(MESSAGE);

    expect(createTransport).toHaveBeenCalledTimes(1);
    // No `tls` override at all, so Node's default verification applies.
    expect(createTransport.mock.calls[0][0]).not.toHaveProperty("tls");
  });

  it("stops verifying, but stays encrypted, when set", async () => {
    process.env.SMTP_TLS_INSECURE = "true";
    await sendMail(MESSAGE);

    const options = createTransport.mock.calls[0][0];
    expect(options.tls).toEqual({ rejectUnauthorized: false });
    // Emphatically not `ignoreTLS`, which would skip STARTTLS altogether and
    // put SMTP_PASSWORD on the wire in clear text.
    expect(options).not.toHaveProperty("ignoreTLS");
  });

  it("rebuilds the pooled transport when the flag changes", async () => {
    await sendMail(MESSAGE);
    await sendMail(MESSAGE);
    // Pooled: the same configuration must not build a second transport.
    expect(createTransport).toHaveBeenCalledTimes(1);

    process.env.SMTP_TLS_INSECURE = "true";
    await sendMail(MESSAGE);

    // The flag is part of the cache key, or flipping it would silently keep
    // using the transport built from the old setting.
    expect(createTransport).toHaveBeenCalledTimes(2);
    expect(createTransport.mock.calls[1][0].tls).toEqual({
      rejectUnauthorized: false,
    });
  });
});
