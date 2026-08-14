import "server-only";

import { readFileSync } from "node:fs";
import type { ConnectionOptions } from "node:tls";

import { Client, type Entry } from "ldapts";

import { ConfigError } from "@/lib/config-error";

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
  | "unavailable"
  /**
   * The deployment is wrong, not the directory. Kept apart from `unavailable`
   * because the two send an investigation to opposite places — see
   * `ConfigError`.
   */
  | "misconfigured";

/**
 * A discriminated union rather than thrown errors, so the route's mapping from
 * reason to (status, Hebrew message) is exhaustive and the compiler checks it.
 */
export type LdapResult =
  | { ok: true; user: DirectoryUser }
  | { ok: false; reason: LdapFailureReason };

/** What the directory search alone can conclude — no password involved. */
export type FindUserResult =
  | { ok: true; user: DirectoryUser }
  | { ok: false; reason: LdapFailureReason };

export type VerifyResult =
  | { ok: true }
  | { ok: false; reason: LdapFailureReason };

/** Requested from every directory regardless of how it spells identity. */
const BASE_ATTRIBUTES = [
  "displayName",
  "cn",
  "mail",
  "userPrincipalName",
  "distinguishedName",
];

/**
 * The only identifier attribute we know to be binary. Everything else — most
 * usefully `entryUUID`, the RFC 4530 attribute AD does *not* implement — comes
 * back as a plain string and is used as-is.
 */
const BINARY_ID_ATTR = "objectguid";

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
  /**
   * Which attributes a typed username may match. Defaults are Active
   * Directory's; an OpenLDAP directory would use `uid,mail`.
   */
  loginAttrs: string[];
  /**
   * The immutable per-user identifier. It has to be immutable, not just unique:
   * everything a user adds hangs off it, and directories reissue usernames.
   * AD has no `entryUUID`, so this is `objectGUID` there and `entryUUID`
   * almost everywhere else.
   */
  idAttr: string;
  /** Narrows the search to user objects. AD spells this differently to everyone else. */
  userFilter: string;
}

function attrList(value: string | undefined, fallback: string[]): string[] {
  const parsed = (value ?? "")
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
  return parsed.length > 0 ? parsed : fallback;
}

/** So the insecure-TLS warning is logged once, not on every login attempt. */
let warnedInsecure = false;

/**
 * A path that doesn't resolve is a deployment fault like any other unset
 * variable — worth saying so, since inside the container `LDAP_TLS_CA` is a
 * host path unless something mounted it.
 */
function readCa(path: string): Buffer {
  try {
    return readFileSync(path);
  } catch (error) {
    throw new ConfigError(
      `LDAP_TLS_CA points at ${path}, which cannot be read: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
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
    throw new ConfigError(
      "LDAP_URL, LDAP_BASE_DN and LDAP_BIND_DN must be set. Copy .env.example to .env.local and fill them in.",
    );
  }

  // An unset service-account password makes the bind below *anonymous* rather
  // than failing: the search then returns nothing and every login looks like a
  // wrong password. Fail loudly here instead.
  if (!bindPassword) {
    throw new ConfigError(
      "LDAP_BIND_PASSWORD is not set. An empty password binds anonymously, which silently breaks every login.",
    );
  }

  if (!url.startsWith("ldaps://") && !startTls) {
    throw new ConfigError(
      "LDAP_URL must be ldaps:// (a simple bind sends the password in cleartext). Set LDAP_STARTTLS=true to upgrade a plain ldap:// connection instead.",
    );
  }

  const caPath = process.env.LDAP_TLS_CA;

  // Turns off verification of the directory's certificate. The connection is
  // still encrypted, so passive sniffing is still off the table; what it gives
  // up is *authenticating* the server, which opens the door to an active MITM
  // harvesting domain passwords. That is an accepted risk here on the grounds
  // that the network is air-gapped — it is not a default, and on any routable
  // network the right fix is LDAP_TLS_CA (or NODE_EXTRA_CA_CERTS) instead.
  const insecure = process.env.LDAP_TLS_INSECURE === "true";

  const tlsOptions =
    caPath || insecure
      ? {
          ...(caPath ? { ca: readCa(caPath) } : {}),
          ...(insecure ? { rejectUnauthorized: false } : {}),
        }
      : undefined;

  if (insecure && !warnedInsecure) {
    warnedInsecure = true;
    console.warn(
      "LDAP_TLS_INSECURE=true — the directory's certificate is not being verified.",
    );
  }

  return {
    url,
    baseDN,
    bindDN,
    bindPassword,
    startTls,
    tlsOptions,
    loginAttrs: attrList(process.env.LDAP_LOGIN_ATTRS, [
      "sAMAccountName",
      "userPrincipalName",
    ]),
    idAttr: process.env.LDAP_ID_ATTR?.trim() || "objectGUID",
    userFilter:
      process.env.LDAP_USER_FILTER?.trim() ||
      "(&(objectCategory=person)(objectClass=user))",
  };
}

/**
 * Force the lazy read, for `instrumentation.ts`. Nothing here touches the
 * network — it only proves the variables parse, which is the half of "can
 * anyone sign in?" that is knowable at boot.
 */
export function assertLdapConfigured(): void {
  config();
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

/**
 * Read a binary identifier as a canonical GUID string.
 *
 * Returns null rather than throwing on anything that isn't 16 bytes: a
 * misconfigured `LDAP_ID_ATTR` pointing at a string attribute should fail the
 * login cleanly, not crash the route.
 */
function firstBufferAsGuid(value: Entry[string] | undefined): string | null {
  const buffer = Buffer.isBuffer(value)
    ? value
    : Array.isArray(value) && Buffer.isBuffer(value[0])
      ? value[0]
      : null;

  return buffer?.length === 16 ? guidToString(buffer) : null;
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

function hasNul(value: string): boolean {
  for (const char of value) if (char.charCodeAt(0) === 0) return true;
  return false;
}

/**
 * Find the directory entry a typed username refers to, using the read-only
 * service account. No user credentials are involved, so this never touches
 * `badPwdCount` and is safe to run before any rate limiting.
 *
 * Split out from the bind so the caller can throttle on the identity this
 * resolves to rather than on the string that was typed: `LDAP_LOGIN_ATTRS`
 * deliberately matches several attributes for one account, and a per-string
 * budget hands every alias its own allowance against a single directory object.
 */
export async function findUser(username: string): Promise<FindUserResult> {
  const trimmed = username.trim();
  if (!trimmed || trimmed.length > 256 || hasNul(trimmed)) {
    return { ok: false, reason: "credentials" };
  }

  let settings: LdapConfig;
  try {
    settings = config();
  } catch (error) {
    // Not a credential problem — and not an outage either. Reporting it as one
    // points whoever investigates at the domain controller, which is the one
    // component that is definitely fine.
    console.error("LDAP configuration error", error);
    return { ok: false, reason: "misconfigured" };
  }

  // Only ever an escaped value inside an equality we build ourselves —
  // `userFilter` is operator config, never a place user input is substituted.
  const escaped = escapeFilterValue(trimmed);
  const match = settings.loginAttrs
    .map((attr) => `(${attr}=${escaped})`)
    .join("");
  const filter = `(&${settings.userFilter}(|${match}))`;

  const idIsBinary = settings.idAttr.toLowerCase() === BINARY_ID_ATTR;

  let serviceClient: Client | undefined;
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
        attributes: [
          ...BASE_ATTRIBUTES,
          settings.idAttr,
          ...settings.loginAttrs,
        ],
        // Only for objectGUID: without this ldapts UTF-8-decodes the 16 raw
        // bytes, which is lossy — invalid sequences collapse to U+FFFD — so two
        // different GUIDs can decode alike and collide on the unique index.
        // A string identifier must NOT be requested this way, or it comes back
        // as a buffer of its own ASCII.
        explicitBufferAttributes: idIsBinary ? [settings.idAttr] : [],
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

    const rawId = entry[settings.idAttr];
    const directoryId = idIsBinary
      ? firstBufferAsGuid(rawId)
      : firstString(rawId)?.toLowerCase();

    // The first configured login attribute is the canonical username; the rest
    // are alternative ways to type it (a UPN, an email) and aren't stored.
    const resolved = firstString(entry[settings.loginAttrs[0]!]);

    if (!directoryId || !resolved) {
      console.error(
        `LDAP entry is missing ${settings.idAttr} or ${settings.loginAttrs[0]}`,
      );
      return { ok: false, reason: "unavailable" };
    }

    return {
      ok: true,
      user: {
        directoryId,
        username: resolved.toLowerCase(),
        upn: firstString(entry.userPrincipalName)?.toLowerCase() ?? null,
        displayName:
          firstString(entry.displayName) ?? firstString(entry.cn) ?? resolved,
        mail: firstString(entry.mail)?.toLowerCase() ?? null,
        dn: firstString(entry.distinguishedName) ?? entry.dn,
      },
    };
  } catch (error) {
    console.error("LDAP connection failed", error);
    return { ok: false, reason: "unavailable" };
  } finally {
    await serviceClient?.unbind().catch(() => {});
  }
}

/**
 * Bind as the user's own DN to prove they know the password.
 *
 * Binding against the DN the directory handed back — rather than templating one
 * out of the input — is why no RFC 4514 DN escaping is needed anywhere here.
 * Don't "simplify" the two calls into one templated bind.
 *
 * A fresh client rather than re-binding the search connection: a failed rebind
 * leaves the connection in an undefined bind state, and whatever touches it next
 * inherits whichever identity stuck.
 */
export async function verifyPassword(
  user: DirectoryUser,
  password: string,
): Promise<VerifyResult> {
  // RFC 4513 defines a bind with a DN and a zero-length password as
  // *unauthenticated authentication*: AD accepts it, returns success, and
  // silently downgrades the connection to anonymous. Reading "the bind
  // resolved" as "the password was correct" would then log anyone in as anyone.
  // The schema enforces min(1) too; this is the layer that actually matters.
  if (password.length === 0) return { ok: false, reason: "credentials" };

  let settings: LdapConfig;
  try {
    settings = config();
  } catch (error) {
    console.error("LDAP configuration error", error);
    return { ok: false, reason: "misconfigured" };
  }

  let client: Client | undefined;
  try {
    client = await connect(settings);
    try {
      await client.bind(user.dn, password);
    } catch (error) {
      return { ok: false, reason: bindFailureReason(error) };
    }
    return { ok: true };
  } catch (error) {
    console.error("LDAP connection failed", error);
    return { ok: false, reason: "unavailable" };
  } finally {
    await client?.unbind().catch(() => {});
  }
}

/**
 * Resolve and verify in one call.
 *
 * The login route deliberately does **not** use this — it has to spend a
 * rate-limit budget between the two halves, keyed on the identity the search
 * resolved to. This is for callers with no such need, and it keeps the whole
 * flow exercisable in a single assertion.
 */
export async function authenticate(
  username: string,
  password: string,
): Promise<LdapResult> {
  // Checked before the search as well as inside verifyPassword, so an empty
  // password costs no directory traffic at all. (The login route never gets
  // here with one — the schema rejects it with a 422.)
  if (password.length === 0) return { ok: false, reason: "credentials" };

  const found = await findUser(username);
  if (!found.ok) return found;

  const verified = await verifyPassword(found.user, password);
  if (!verified.ok) return verified;

  return { ok: true, user: found.user };
}

