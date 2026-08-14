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
  resetSessionKeyCache();
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  resetSessionKeyCache();
});

function logged(): string {
  return vi
    .mocked(console.error)
    .mock.calls.flat()
    .map(String)
    .join("\n");
}

describe("register", () => {
  it("says nothing when everything is set", async () => {
    // tests/setup/env.ts supplies a full, valid configuration.
    await register();

    expect(console.error).not.toHaveBeenCalled();
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
