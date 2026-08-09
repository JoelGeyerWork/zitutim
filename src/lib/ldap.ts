import "server-only";

import { readFileSync } from "node:fs";
import type { ConnectionOptions } from "node:tls";

import { Client, type Entry } from "ldapts";

/** What we keep from a directory entry. Everything else is deliberately dropped. */
export interface DirectoryUser {
  /** objectGUID in canonical string form. Immutable for the object's lifetime. */
  directoryId: string;
  /** sAMAccountName, lowercased. */
  username: string;
  /** userPrincipalName, lowercased. */
  upn: string | null;
  displayName: string;
  mail: string | null;
  /** distinguishedName as the server returned it. Changes when the object moves. */
  dn: string;
}

export type LdapFailureReason =
  | "credentials"
  | "password-expired"
  | "must-change-password"
  | "locked"
  | "unavailable";

/**
 * A discriminated union rather than thrown errors, so the route's mapping from
 * reason to (status, Hebrew message) is exhaustive and the compiler checks it.
 */
export type LdapResult =
  | { ok: true; user: DirectoryUser }
  | { ok: false; reason: LdapFailureReason };

const ATTRIBUTES = [
  "objectGUID",
  "sAMAccountName",
  "userPrincipalName",
  "displayName",
  "cn",
  "mail",
  "distinguishedName",
];

/**
 * AD reports the specific bind failure as a hex sub-code in the error text.
 *
 * Everything that maps to `credentials` must produce one identical message to
 * the user: distinguishing "no such account" from "wrong password" is an
 * account-enumeration oracle. The three that are surfaced specifically are only
 * reachable by someone who already supplied the correct password (AD validates
 * it before reporting expiry), so they leak nothing — except `775`, which does
 * reveal the account exists, but only to whoever caused the lockout, and hiding
 * it just produces a support queue of "it only says wrong password".
 */
const SUBCODE_REASONS: Record<string, LdapFailureReason> = {
  "525": "credentials", // user not found
  "52e": "credentials", // wrong password
  "530": "credentials", // outside permitted logon hours
  "531": "credentials", // not permitted from this workstation
  "532": "password-expired",
  "533": "credentials", // account disabled
  "701": "credentials", // account expired
  "773": "must-change-password",
  "775": "locked",
};

interface LdapConfig {
  url: string;
  baseDN: string;
  bindDN: string;
  bindPassword: string;
  startTls: boolean;
  tlsOptions: ConnectionOptions | undefined;
}

/**
 * Read lazily, like `getClient()` in mongodb.ts — the test suite sets these
 * after imports have already run.
 */
function config(): LdapConfig {
  const url = process.env.LDAP_URL;
  const baseDN = process.env.LDAP_BASE_DN;
  const bindDN = process.env.LDAP_BIND_DN;
  const bindPassword = process.env.LDAP_BIND_PASSWORD;
  const startTls = process.env.LDAP_STARTTLS === "true";

  if (!url || !baseDN || !bindDN) {
    throw new Error(
      "LDAP_URL, LDAP_BASE_DN and LDAP_BIND_DN must be set. Copy .env.example to .env.local and fill them in.",
    );
  }

  // An unset service-account password makes the bind below *anonymous* rather
  // than failing: the search then returns nothing and every login looks like a
  // wrong password. Fail loudly here instead.
  if (!bindPassword) {
    throw new Error(
      "LDAP_BIND_PASSWORD is not set. An empty password binds anonymously, which silently breaks every login.",
    );
  }

  if (!url.startsWith("ldaps://") && !startTls) {
    throw new Error(
      "LDAP_URL must be ldaps:// (a simple bind sends the password in cleartext). Set LDAP_STARTTLS=true to upgrade a plain ldap:// connection instead.",
    );
  }

  // Deliberately no "skip certificate verification" option. Internal DCs
  // usually use a private CA and the first instinct is to turn verification
  // off, which is strictly worse than no TLS: it invites an undetectable MITM
  // harvesting domain passwords. Point LDAP_TLS_CA at the enterprise root
  // instead (or use NODE_EXTRA_CA_CERTS).
  const caPath = process.env.LDAP_TLS_CA;
  const tlsOptions = caPath ? { ca: readFileSync(caPath) } : undefined;

  return { url, baseDN, bindDN, bindPassword, startTls, tlsOptions };
}

const FILTER_ESCAPES: Record<string, string> = {
  "\\": "\\5c",
  "*": "\\2a",
  "(": "\\28",
  ")": "\\29",
  // Not required by RFC 4515, but conventionally escaped for AD and harmless.
  "/": "\\2f",
};

/**
 * Escape a value going into an LDAP filter, per RFC 4515 §3.
 *
 * The same invariant as `escapeRegex()` in quotes.ts: a user-supplied string
 * must match literally, not restructure the expression around it. Unescaped,
 * `admin)(objectClass=*` turns the `(|...)` clause below into a match on the
 * first user in the directory.
 *
 * Walks the input once rather than chaining `.replace()` calls, which would
 * re-escape the backslashes they had just inserted.
 */
export function escapeFilterValue(value: string): string {
  let out = "";
  for (const char of value) {
    const escape = FILTER_ESCAPES[char];
    if (escape) out += escape;
    else if (char.charCodeAt(0) === 0) out += "\\00";
    else out += char;
  }
  return out;
}

/**
 * AD hands back objectGUID as 16 raw bytes. The canonical string form reads the
 * first three fields little-endian and the last two big-endian; reading it
 * straight through yields a stable-but-wrong id that silently disagrees with
 * every other tool printing the same GUID.
 */
export function guidToString(buffer: Buffer): string {
  if (buffer.length !== 16) {
    throw new Error(`objectGUID must be 16 bytes, got ${buffer.length}`);
  }

  const hex = (start: number, end: number) =>
    buffer.subarray(start, end).toString("hex");

  return [
    buffer.readUInt32LE(0).toString(16).padStart(8, "0"),
    buffer.readUInt16LE(4).toString(16).padStart(4, "0"),
    buffer.readUInt16LE(6).toString(16).padStart(4, "0"),
    hex(8, 10),
    hex(10, 16),
  ].join("-");
}

/** Entry values arrive as string, string[], Buffer or Buffer[] depending on the attribute. */
function firstString(value: Entry[string] | undefined): string | null {
  if (value === undefined) return null;
  if (typeof value === "string") return value || null;
  if (Buffer.isBuffer(value)) return value.toString("utf8") || null;

  const first = value[0];
  if (first === undefined) return null;
  return (typeof first === "string" ? first : first.toString("utf8")) || null;
}

function firstBuffer(value: Entry[string] | undefined): Buffer | null {
  if (Buffer.isBuffer(value)) return value;
  if (Array.isArray(value) && Buffer.isBuffer(value[0])) return value[0];
  return null;
}

/**
 * Duck-typed rather than `instanceof ResultCodeError`: the test suite replaces
 * the whole `ldapts` module, which would replace the error classes too and make
 * an identity check silently never match.
 */
function resultCode(error: unknown): number | undefined {
  if (error && typeof error === "object" && "code" in error) {
    const { code } = error as { code: unknown };
    if (typeof code === "number") return code;
  }
  return undefined;
}

function bindFailureReason(error: unknown): LdapFailureReason {
  // 49 is invalidCredentials — the class of failure that carries a sub-code.
  // Anything else (network, TLS, a broken base DN) is an outage, not a bad
  // password, and must stay distinguishable: otherwise a DC going down looks
  // like the entire company simultaneously forgetting their password.
  if (resultCode(error) !== 49) return "unavailable";

  const message = error instanceof Error ? error.message : String(error);
  const subCode = /data ([0-9a-f]{3,4})/i.exec(message)?.[1]?.toLowerCase();

  return (subCode && SUBCODE_REASONS[subCode]) || "credentials";
}

function createClient(settings: LdapConfig): Client {
  return new Client({
    url: settings.url,
    // Without these an unreachable DC pins the request until the socket gives
    // up, rather than failing in a few seconds.
    connectTimeout: 5_000,
    timeout: 10_000,
    tlsOptions: settings.tlsOptions,
  });
}

async function connect(settings: LdapConfig): Promise<Client> {
  const client = createClient(settings);
  if (settings.startTls) await client.startTLS(settings.tlsOptions);
  return client;
}

/**
 * Verify a username and password against Active Directory.
 *
 * Two binds: once as the service account to find the user's DN, then again as
 * that DN with their password. Binding against the DN the server handed back —
 * rather than templating one out of the input — is why no RFC 4514 DN escaping
 * is needed anywhere here. Don't "simplify" it into a single templated bind.
 */
export async function authenticate(
  username: string,
  password: string,
): Promise<LdapResult> {
  // RFC 4513 defines a bind with a DN and a zero-length password as
  // *unauthenticated authentication*: AD accepts it, returns success, and
  // silently downgrades the connection to anonymous. Reading "the bind
  // resolved" as "the password was correct" would then log anyone in as anyone.
  // The schema enforces min(1) too; this is the layer that actually matters.
  if (password.length === 0) return { ok: false, reason: "credentials" };

  const trimmed = username.trim();
  if (!trimmed || trimmed.length > 256 || trimmed.includes("\0")) {
    return { ok: false, reason: "credentials" };
  }

  let settings: LdapConfig;
  try {
    settings = config();
  } catch (error) {
    // A misconfiguration is an outage, not a credential problem.
    console.error("LDAP configuration error", error);
    return { ok: false, reason: "unavailable" };
  }

  const escaped = escapeFilterValue(trimmed);
  const filter =
    "(&(objectCategory=person)(objectClass=user)" +
    // AD's bitwise-AND matching rule on userAccountControl. Excluding
    // ACCOUNTDISABLE here keeps disabled accounts from being enumerable at all.
    "(!(userAccountControl:1.2.840.113556.1.4.803:=2))" +
    `(|(sAMAccountName=${escaped})(userPrincipalName=${escaped})))`;

  let serviceClient: Client | undefined;
  let userClient: Client | undefined;

  try {
    serviceClient = await connect(settings);

    try {
      await serviceClient.bind(settings.bindDN, settings.bindPassword);
    } catch (error) {
      console.error("LDAP service account bind failed", error);
      return { ok: false, reason: "unavailable" };
    }

    let entries: Entry[];
    try {
      const result = await serviceClient.search(settings.baseDN, {
        scope: "sub",
        filter,
        attributes: ATTRIBUTES,
        // Without this, ldapts UTF-8-decodes the 16 raw GUID bytes. That is
        // lossy — invalid sequences collapse to U+FFFD — so two different
        // GUIDs can decode to the same string and collide on the unique index.
        explicitBufferAttributes: ["objectGUID"],
        sizeLimit: 2,
        timeLimit: 5,
      });
      entries = result.searchEntries;
    } catch (error) {
      console.error("LDAP search failed", error);
      return { ok: false, reason: "unavailable" };
    }

    if (entries.length === 0) return { ok: false, reason: "credentials" };
    if (entries.length > 1) {
      // The base DN spans domains with colliding sAMAccountNames. That is a
      // configuration bug, and it must not be allowed to become an auth bypass.
      console.error(
        `LDAP search matched ${entries.length} entries for one username; refusing to guess`,
      );
      return { ok: false, reason: "credentials" };
    }

    const entry = entries[0]!;
    const guid = firstBuffer(entry.objectGUID);
    const sam = firstString(entry.sAMAccountName);
    if (!guid || !sam) {
      console.error("LDAP entry is missing objectGUID or sAMAccountName");
      return { ok: false, reason: "unavailable" };
    }

    const dn = firstString(entry.distinguishedName) ?? entry.dn;

    userClient = await connect(settings);
    try {
      await userClient.bind(dn, password);
    } catch (error) {
      return { ok: false, reason: bindFailureReason(error) };
    }

    return {
      ok: true,
      user: {
        directoryId: guidToString(guid),
        username: sam.toLowerCase(),
        upn: firstString(entry.userPrincipalName)?.toLowerCase() ?? null,
        displayName:
          firstString(entry.displayName) ?? firstString(entry.cn) ?? sam,
        mail: firstString(entry.mail)?.toLowerCase() ?? null,
        dn,
      },
    };
  } catch (error) {
    console.error("LDAP connection failed", error);
    return { ok: false, reason: "unavailable" };
  } finally {
    // Both clients, always — a leaked connection outlives the request.
    await serviceClient?.unbind().catch(() => {});
    await userClient?.unbind().catch(() => {});
  }
}
