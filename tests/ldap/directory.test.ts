import { createConnection } from "node:net";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { authenticate, findPeople, findPersonById } from "@/lib/ldap";

/**
 * The directory *search* (`findPeople` / `findPersonById`) against the real
 * OpenLDAP from docker-compose.ldap.yml — a real service-account bind, a real
 * substring filter, real `entryUUID` string ids. `tests/server/ldap.test.ts`
 * covers the objectGUID byte order this plain directory cannot produce.
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

const up = await reachable();

if (up) {
  process.env.LDAP_URL = `ldaps://${HOST}:${PORT}`;
  process.env.LDAP_BASE_DN = "dc=test,dc=local";
  process.env.LDAP_BIND_DN = "cn=admin,dc=test,dc=local";
  process.env.LDAP_BIND_PASSWORD = "admin-password";
  process.env.LDAP_TLS_CA = join(process.cwd(), ".ldap", "certs", "ca.pem");
  process.env.LDAP_TLS_INSECURE = "true";
  process.env.LDAP_USER_FILTER = "(objectClass=inetOrgPerson)";
  process.env.LDAP_LOGIN_ATTRS = "uid,mail";
  process.env.LDAP_ID_ATTR = "entryUUID";
  // OpenLDAP implements no `anr`, which is the production default. This is the
  // mode that exists for directories like it — and the reason the mode is
  // configuration rather than a constant.
  process.env.LDAP_SEARCH_MODE = "substring";
} else {
  console.warn(
    `\nNo LDAP server on ${HOST}:${PORT} — skipping. Start one with: npm run ldap:up\n`,
  );
}

describe.skipIf(!up)("directory search against a real directory", () => {
  it("finds people by a substring of their name or username", async () => {
    const people = await findPeople("dan");

    const dana = people.find((person) => person.username === "dana");
    expect(dana).toMatchObject({
      displayName: "דנה כהן",
      username: "dana",
    });
    // entryUUID, taken as-is — the same id `authenticate` resolves.
    expect(dana?.directoryId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );
  });

  it("opens no connection and returns [] under two characters", async () => {
    await expect(findPeople("d")).resolves.toEqual([]);
  });

  it("re-resolves a person by their entryUUID", async () => {
    // Learn dana's id the way an add does — from a prior search / login.
    const signedIn = await authenticate("dana", "correct-horse");
    expect(signedIn.ok).toBe(true);
    const id = signedIn.ok ? signedIn.user.directoryId : "";

    const person = await findPersonById(id);
    expect(person).toMatchObject({ username: "dana", displayName: "דנה כהן" });
    expect(person?.directoryId).toBe(id);
  });

  it("returns null for an id nobody has", async () => {
    await expect(
      findPersonById("00000000-0000-0000-0000-000000000000"),
    ).resolves.toBeNull();
  });
});
