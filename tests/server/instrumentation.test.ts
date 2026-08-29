import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { register } from "@/instrumentation";
import { resetSessionKeyCache } from "@/lib/session";

/**
 * The boot-time check that stops a misconfigured deployment from looking
 * healthy right up until the first person tries to sign in.
 */
beforeEach(() => {
  vi.stubEnv("NEXT_RUNTIME", "nodejs");
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  resetSessionKeyCache();

  // tests/setup/env.ts deliberately leaves the mail block unset, so give the
  // mail check a valid configuration by default and let each test remove it.
  vi.stubEnv("SMTP_HOST", "relay.test.local");
  vi.stubEnv("MAIL_FROM", "zitutim@test.local");
  vi.stubEnv("MAIL_TO", "team@test.local");
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  resetSessionKeyCache();
});

function logged(): string {
  return vi.mocked(console.error).mock.calls.flat().map(String).join("\n");
}

function warned(): string {
  return vi.mocked(console.warn).mock.calls.flat().map(String).join("\n");
}

describe("register", () => {
  it("says nothing when everything is set", async () => {
    // tests/setup/env.ts supplies a full, valid configuration.
    await register();

    expect(console.error).not.toHaveBeenCalled();
    expect(console.warn).not.toHaveBeenCalled();
  });

  it("warns rather than errors about unconfigured mail", async () => {
    vi.stubEnv("SMTP_HOST", "");

    await register();

    // A warning, not an error, because the blast radius is different: sign-in
    // being broken costs every write, while unconfigured mail costs only the
    // share button. Reporting them at the same level hides that.
    expect(console.error).not.toHaveBeenCalled();
    expect(warned()).toContain("SMTP_HOST");
    expect(warned()).toContain("Outgoing mail is not configured");
  });

  it("reports auth and mail separately when both are wrong", async () => {
    vi.stubEnv("SESSION_SECRET", "");
    vi.stubEnv("MAIL_TO", "");
    resetSessionKeyCache();

    await register();

    // Neither check swallows the other — they send whoever is fixing this to
    // two different parts of the same file.
    expect(logged()).toContain("SESSION_SECRET");
    expect(logged()).not.toContain("MAIL_TO");
    expect(warned()).toContain("MAIL_TO");
  });

  it("reports every problem at once, not just the first", async () => {
    // They come from one file, so whoever is fixing this wants the whole list
    // in a single pass rather than one restart per variable.
    vi.stubEnv("SESSION_SECRET", "");
    vi.stubEnv("LDAP_BIND_PASSWORD", "");
    resetSessionKeyCache();

    await register();

    expect(logged()).toContain("SESSION_SECRET");
    expect(logged()).toContain("LDAP_BIND_PASSWORD");
  });

  it("resolves rather than throwing", async () => {
    // Throwing from register() does not stop the process: Next keeps the port
    // open and serves 500 for *every* route, so a login misconfiguration would
    // take the public feed down with it.
    vi.stubEnv("LDAP_URL", "");

    await expect(register()).resolves.toBeUndefined();
  });

  it("does nothing outside the node runtime", async () => {
    // node:fs and ldapts do not exist on the edge runtime, and the check has
    // nothing to say there anyway.
    vi.stubEnv("NEXT_RUNTIME", "edge");
    vi.stubEnv("SESSION_SECRET", "");
    resetSessionKeyCache();

    await register();

    expect(console.error).not.toHaveBeenCalled();
  });
});
