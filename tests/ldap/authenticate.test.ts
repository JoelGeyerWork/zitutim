import { createConnection } from "node:net";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { authenticate, escapeFilterValue } from "@/lib/ldap";

/**
 * Exercises the real client against the real OpenLDAP from
 * docker-compose.ldap.yml — real BER encoding, a real TLS handshake, a real
 * bind. `tests/server/ldap.test.ts` drives the same code through a fake client
 * and covers the AD-only behaviour this server cannot produce.
 *
 * Start it with `npm run ldap:up`; without it every test here skips.
 */
const HOST = "localhost";
const PORT = 1636;

function reachable(): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = createConnection({ host: HOST, port: PORT });
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
  // Plain LDAP, not AD: identity is spelled uid / entryUUID here.
  process.env.LDAP_URL = `ldaps://${HOST}:${PORT}`;
  process.env.LDAP_BASE_DN = "dc=test,dc=local";
  process.env.LDAP_BIND_DN = "cn=admin,dc=test,dc=local";
  process.env.LDAP_BIND_PASSWORD = "admin-password";
  process.env.LDAP_TLS_CA = join(process.cwd(), ".ldap", "certs", "ca.pem");
  process.env.LDAP_TLS_INSECURE = "true";
  process.env.LDAP_USER_FILTER = "(objectClass=inetOrgPerson)";
  process.env.LDAP_LOGIN_ATTRS = "uid,mail";
  process.env.LDAP_ID_ATTR = "entryUUID";
} else {
  console.warn(
    `\nNo LDAP server on ${HOST}:${PORT} — skipping. Start one with: npm run ldap:up\n`,
  );
}

describe.skipIf(!up)("authenticate against a real directory", () => {
  it("signs a user in over LDAPS", async () => {
    const result = await authenticate("dana", "correct-horse");

    expect(result).toEqual({
      ok: true,
      user: {
        // A string entryUUID, taken as-is — only objectGUID is byte-decoded.
        directoryId: expect.stringMatching(
          /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
        ),
        username: "dana",
        upn: null,
        displayName: "דנה כהן",
        mail: "dana@test.local",
        dn: "uid=dana,ou=people,dc=test,dc=local",
      },
    });
  });

  it("returns a stable id across logins", async () => {
    // The whole reason the id is a directory attribute and not the username.
    const first = await authenticate("dana", "correct-horse");
    const second = await authenticate("dana", "correct-horse");

    expect(first).toMatchObject({ ok: true });
    expect(second).toMatchObject({ ok: true });
    expect(first.ok && first.user.directoryId).toBe(
      second.ok && second.user.directoryId,
    );
  });

  it("gives different users different ids", async () => {
    const dana = await authenticate("dana", "correct-horse");
    const omer = await authenticate("omer", "another-password");

    expect(dana.ok && dana.user.directoryId).not.toBe(
      omer.ok && omer.user.directoryId,
    );
  });

  it("accepts any configured login attribute", async () => {
    // LDAP_LOGIN_ATTRS is uid,mail — signing in with the address must land on
    // the same account.
    const byMail = await authenticate("Dana@Test.Local", "correct-horse");

    expect(byMail).toMatchObject({ ok: true, user: { username: "dana" } });
  });

  it("falls back to cn when the entry has no displayName", async () => {
    const result = await authenticate("noa", "third-password");

    expect(result).toMatchObject({ ok: true, user: { displayName: "Noa Bar" } });
  });

  it.each([
    ["a wrong password", "dana", "wrong"],
    ["an unknown user", "nobody", "correct-horse"],
  ])("rejects %s", async (_label, username, password) => {
    await expect(authenticate(username, password)).resolves.toEqual({
      ok: false,
      reason: "credentials",
    });
  });

  it("answers identically for a wrong password and an unknown user", async () => {
    // Any difference between these two is an account-enumeration oracle.
    const wrong = await authenticate("dana", "wrong");
    const unknown = await authenticate("nobody", "wrong");

    expect(wrong).toEqual(unknown);
  });

  it("never binds with an empty password", async () => {
    // RFC 4513's unauthenticated bind: a DN with a zero-length password. AD
    // answers success and downgrades to anonymous; whatever this server does,
    // the client must refuse before it ever gets there.
    await expect(authenticate("dana", "")).resolves.toEqual({
      ok: false,
      reason: "credentials",
    });
  });

  it("neutralises a filter-injection attempt", async () => {
    // Unescaped, this closes the uid clause and adds a match-anything one,
    // which would return the first inetOrgPerson in the tree.
    expect(escapeFilterValue("dana)(objectClass=*")).toBe(
      "dana\\29\\28objectClass=\\2a",
    );

    await expect(
      authenticate("dana)(objectClass=*", "correct-horse"),
    ).resolves.toEqual({ ok: false, reason: "credentials" });
  });

  it("refuses an untrusted certificate when verification is on", async () => {
    // No CA and no opt-out: the connection has to fail rather than fall back to
    // trusting whatever answered.
    const ca = process.env.LDAP_TLS_CA;
    process.env.LDAP_TLS_CA = "";
    process.env.LDAP_TLS_INSECURE = "false";
    try {
      await expect(authenticate("dana", "correct-horse")).resolves.toEqual({
        ok: false,
        reason: "unavailable",
      });
    } finally {
      process.env.LDAP_TLS_CA = ca;
      process.env.LDAP_TLS_INSECURE = "true";
    }
  });

  it("connects without a CA when verification is disabled", async () => {
    // What LDAP_TLS_INSECURE buys, stated as a test so it can't rot: still
    // encrypted, just not authenticating the server.
    const ca = process.env.LDAP_TLS_CA;
    process.env.LDAP_TLS_CA = "";
    try {
      await expect(authenticate("dana", "correct-horse")).resolves.toMatchObject(
        { ok: true },
      );
    } finally {
      process.env.LDAP_TLS_CA = ca;
    }
  });

  it("reports an unreachable server as unavailable, not bad credentials", async () => {
    const url = process.env.LDAP_URL;
    process.env.LDAP_URL = "ldaps://localhost:1";
    try {
      await expect(authenticate("dana", "correct-horse")).resolves.toEqual({
        ok: false,
        reason: "unavailable",
      });
    } finally {
      process.env.LDAP_URL = url;
    }
  });
});
