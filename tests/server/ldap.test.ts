import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { authenticate, escapeFilterValue, guidToString } from "@/lib/ldap";

/** The source escape sequence gets mangled by tooling, so build it explicitly. */
const NUL = String.fromCharCode(0);

/**
 * A fake ldapts Client driven by a mutable `state`, so a test can set up the
 * directory's responses before calling `authenticate`. Every instance is
 * recorded in order: the service-account client is constructed first, the user
 * client second, which is how the tests assert *which* client bound with what.
 *
 * The factory is hoisted above the imports, so everything it closes over has to
 * come from `vi.hoisted`.
 */
const ldap = vi.hoisted(() => {
  /** Just the fields the tests assert on. */
  interface FakeSearchOptions {
    scope?: string;
    filter?: string;
    attributes?: string[];
    explicitBufferAttributes?: string[];
    sizeLimit?: number;
    timeLimit?: number;
  }

  const state = {
    searchEntries: [] as unknown[],
    searchError: undefined as unknown,
    serviceBindError: undefined as unknown,
    userBindError: undefined as unknown,
  };

  const clients: InstanceType<typeof Client>[] = [];

  class Client {
    index = 0;
    options: unknown;

    // The signatures are declared on vi.fn rather than as parameters so that
    // `mock.calls` is a usable tuple without carrying unused arguments.
    bind = vi.fn<(dn: string, password?: string) => Promise<void>>(async () => {
      const error =
        this.index === 0 ? state.serviceBindError : state.userBindError;
      if (error) throw error;
    });

    search = vi.fn<
      (
        baseDN: string,
        options: FakeSearchOptions,
      ) => Promise<{ searchEntries: unknown[]; searchReferences: string[] }>
    >(async () => {
      if (state.searchError) throw state.searchError;
      return {
        searchEntries: state.searchEntries,
        searchReferences: [],
      };
    });

    unbind = vi.fn(async () => {});
    startTLS = vi.fn(async () => {});

    constructor(options: unknown) {
      this.options = options;
      this.index = clients.length;
      clients.push(this);
    }
  }

  return {
    state,
    clients,
    Client,
    service: () => clients[0]!,
    user: () => clients[1]!,
    reset() {
      clients.length = 0;
      state.searchEntries = [];
      state.searchError = undefined;
      state.serviceBindError = undefined;
      state.userBindError = undefined;
    },
  };
});

vi.mock("ldapts", () => ({ Client: ldap.Client }));

/** The 16 bytes AD would return for objectGUID. */
const GUID_BYTES = Buffer.from([
  0x00, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08, 0x09, 0x0a, 0x0b, 0x0c,
  0x0d, 0x0e, 0x0f,
]);

const ENTRY = {
  dn: "CN=Dana Cohen,OU=Users,DC=test,DC=local",
  objectGUID: GUID_BYTES,
  sAMAccountName: "Dana",
  userPrincipalName: "Dana@Test.Local",
  displayName: "דנה כהן",
  cn: "Dana Cohen",
  mail: "Dana@Test.Local",
  distinguishedName: "CN=Dana Cohen,OU=Users,DC=test,DC=local",
};

/** An AD bind rejection: result code 49, with a hex sub-code in the message. */
function adError(subCode: string) {
  return Object.assign(
    new Error(
      `80090308: LdapErr: DSID-0C09042A, comment: AcceptSecurityContext error, data ${subCode}, v3839`,
    ),
    { code: 49 },
  );
}

beforeEach(() => {
  ldap.reset();
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("escapeFilterValue", () => {
  it.each([
    ["backslash", "\\", "\\5c"],
    ["asterisk", "*", "\\2a"],
    ["open paren", "(", "\\28"],
    ["close paren", ")", "\\29"],
    ["forward slash", "/", "\\2f"],
    ["NUL", NUL, "\\00"],
  ])("escapes %s", (_label, input, expected) => {
    expect(escapeFilterValue(input)).toBe(expected);
  });

  it("leaves ordinary text alone, Hebrew included", () => {
    expect(escapeFilterValue("dana.cohen")).toBe("dana.cohen");
    expect(escapeFilterValue("דנה")).toBe("דנה");
  });

  it("neutralises a filter-injection payload", () => {
    // Unescaped, this closes the sAMAccountName clause and adds a
    // match-anything one, returning the first user in the directory.
    expect(escapeFilterValue("admin)(objectClass=*")).toBe(
      "admin\\29\\28objectClass=\\2a",
    );
  });

  it("does not double-escape the backslashes it inserts", () => {
    // A chained .replace() implementation turns this into \5c5c.
    expect(escapeFilterValue("\\\\")).toBe("\\5c\\5c");
    expect(escapeFilterValue("a\\*b")).toBe("a\\5c\\2ab");
  });
});

describe("guidToString", () => {
  it("reads the first three fields little-endian and the rest big-endian", () => {
    // Reading straight through gives 00010203-0405-0607-… — stable, but
    // disagreeing with every other tool that prints the same GUID.
    expect(guidToString(GUID_BYTES)).toBe(
      "03020100-0504-0706-0809-0a0b0c0d0e0f",
    );
  });

  it("rejects a buffer that is not 16 bytes", () => {
    expect(() => guidToString(Buffer.alloc(8))).toThrow(/16 bytes/);
  });
});

describe("authenticate", () => {
  it("binds as the service account, then as the user's own DN", async () => {
    ldap.state.searchEntries = [ENTRY];

    const result = await authenticate("dana", "correct-horse");

    expect(result).toEqual({
      ok: true,
      user: {
        directoryId: "03020100-0504-0706-0809-0a0b0c0d0e0f",
        username: "dana",
        upn: "dana@test.local",
        displayName: "דנה כהן",
        mail: "dana@test.local",
        dn: "CN=Dana Cohen,OU=Users,DC=test,DC=local",
      },
    });

    expect(ldap.clients).toHaveLength(2);
    expect(ldap.service().bind).toHaveBeenCalledWith(
      "CN=svc,OU=Service Accounts,DC=test,DC=local",
      "service-account-password",
    );
    // Bound against the DN the server returned, never one templated out of
    // input — which is why no RFC 4514 DN escaping is needed anywhere.
    expect(ldap.user().bind).toHaveBeenCalledWith(
      "CN=Dana Cohen,OU=Users,DC=test,DC=local",
      "correct-horse",
    );
  });

  it("falls back to cn when the entry has no displayName", async () => {
    ldap.state.searchEntries = [{ ...ENTRY, displayName: undefined }];

    const result = await authenticate("dana", "correct-horse");

    expect(result).toMatchObject({ ok: true, user: { displayName: "Dana Cohen" } });
  });

  it("never binds with an empty password", async () => {
    // RFC 4513: a bind with a DN and a zero-length password is an
    // *unauthenticated* bind. AD returns success and downgrades the connection
    // to anonymous, so reaching the bind at all logs anyone in as anyone.
    const result = await authenticate("dana", "");

    expect(result).toEqual({ ok: false, reason: "credentials" });
    expect(ldap.clients).toHaveLength(0);
  });

  it.each([
    ["blank", "   "],
    ["over 256 chars", "a".repeat(257)],
    ["containing NUL", `da${NUL}na`],
  ])(
    "rejects a username that is %s without contacting the DC",
    async (_label, username) => {
      const result = await authenticate(username, "correct-horse");

      expect(result).toEqual({ ok: false, reason: "credentials" });
      expect(ldap.clients).toHaveLength(0);
    },
  );

  it("escapes the username before it reaches the filter", async () => {
    await authenticate("admin)(objectClass=*", "correct-horse");

    const options = ldap.service().search.mock.calls[0]![1];
    expect(options.filter).toContain("admin\\29\\28objectClass=\\2a");
    expect(options.filter).not.toContain("admin)(objectClass=*");
  });

  it("asks for objectGUID as a raw buffer and searches the configured base", async () => {
    await authenticate("dana", "correct-horse");

    const [baseDN, options] = ldap.service().search.mock.calls[0]!;
    expect(baseDN).toBe("OU=Users,DC=test,DC=local");
    // Without this ldapts UTF-8-decodes the raw bytes, which is lossy enough
    // that two distinct GUIDs can collide on the unique index.
    expect(options.explicitBufferAttributes).toEqual(["objectGUID"]);
    expect(options.scope).toBe("sub");
    expect(options.sizeLimit).toBe(2);
  });

  it("matches the username against every configured login attribute", async () => {
    await authenticate("dana", "correct-horse");

    const options = ldap.service().search.mock.calls[0]![1];
    expect(options.filter).toBe(
      "(&(&(objectCategory=person)(objectClass=user))(|(sAMAccountName=dana)(userPrincipalName=dana)))",
    );
  });

  it("leaves a disabled account to fail at the bind", async () => {
    // There is deliberately no userAccountControl clause in the filter: AD
    // refuses to bind a disabled account anyway (sub-code 533), which lands on
    // the same `credentials` answer, so filtering it out bought nothing and cost
    // portability to directories without that matching rule.
    ldap.state.searchEntries = [ENTRY];
    ldap.state.userBindError = adError("533");

    await expect(authenticate("dana", "correct-horse")).resolves.toEqual({
      ok: false,
      reason: "credentials",
    });
  });

  it("fails as bad credentials when the search finds nobody", async () => {
    ldap.state.searchEntries = [];

    const result = await authenticate("nosuchuser", "correct-horse");

    expect(result).toEqual({ ok: false, reason: "credentials" });
    // The user client is never even constructed.
    expect(ldap.clients).toHaveLength(1);
  });

  it("refuses to guess when the search matches more than one entry", async () => {
    // A base DN spanning domains with colliding sAMAccountNames is a config
    // bug; it must not be allowed to become an auth bypass.
    ldap.state.searchEntries = [
      ENTRY,
      { ...ENTRY, dn: "CN=Other,DC=test,DC=local" },
    ];

    const result = await authenticate("dana", "correct-horse");

    expect(result).toEqual({ ok: false, reason: "credentials" });
    expect(ldap.clients).toHaveLength(1);
  });

  describe("AD sub-codes", () => {
    it.each([
      ["525 user not found", "525", "credentials"],
      ["52e wrong password", "52e", "credentials"],
      ["530 outside logon hours", "530", "credentials"],
      ["531 wrong workstation", "531", "credentials"],
      ["532 password expired", "532", "password-expired"],
      ["533 account disabled", "533", "credentials"],
      ["701 account expired", "701", "credentials"],
      ["773 must change password", "773", "must-change-password"],
      ["775 locked out", "775", "locked"],
      ["an unrecognised sub-code", "999", "credentials"],
    ])("maps %s", async (_label, subCode, reason) => {
      ldap.state.searchEntries = [ENTRY];
      ldap.state.userBindError = adError(subCode);

      await expect(authenticate("dana", "wrong")).resolves.toEqual({
        ok: false,
        reason,
      });
    });

    it("treats an uppercase sub-code the same", async () => {
      ldap.state.searchEntries = [ENTRY];
      ldap.state.userBindError = adError("52E");

      await expect(authenticate("dana", "wrong")).resolves.toEqual({
        ok: false,
        reason: "credentials",
      });
    });
  });

  it("reports a network failure as unavailable, not bad credentials", async () => {
    // A DC outage must not look like the entire company simultaneously
    // forgetting their password.
    ldap.state.searchEntries = [ENTRY];
    ldap.state.userBindError = Object.assign(
      new Error("connect ECONNREFUSED 10.0.0.1:636"),
      { code: "ECONNREFUSED" },
    );

    await expect(authenticate("dana", "correct-horse")).resolves.toEqual({
      ok: false,
      reason: "unavailable",
    });
  });

  it("reports a failed service-account bind as unavailable", async () => {
    ldap.state.serviceBindError = adError("52e");

    await expect(authenticate("dana", "correct-horse")).resolves.toEqual({
      ok: false,
      reason: "unavailable",
    });
    expect(ldap.clients).toHaveLength(1);
  });

  it("reports a failed search as unavailable", async () => {
    ldap.state.searchError = new Error("size limit exceeded");

    await expect(authenticate("dana", "correct-horse")).resolves.toEqual({
      ok: false,
      reason: "unavailable",
    });
  });

  it("unbinds both clients even when the user bind throws", async () => {
    ldap.state.searchEntries = [ENTRY];
    ldap.state.userBindError = adError("52e");

    await authenticate("dana", "wrong");

    expect(ldap.service().unbind).toHaveBeenCalled();
    expect(ldap.user().unbind).toHaveBeenCalled();
  });

  it("unbinds on the happy path too", async () => {
    ldap.state.searchEntries = [ENTRY];

    await authenticate("dana", "correct-horse");

    expect(ldap.service().unbind).toHaveBeenCalled();
    expect(ldap.user().unbind).toHaveBeenCalled();
  });

  it("passes connect and operation timeouts to the client", async () => {
    await authenticate("dana", "correct-horse");

    expect(ldap.service().options).toMatchObject({
      url: "ldaps://dc.test.local:636",
      connectTimeout: 5_000,
      timeout: 10_000,
    });
  });

  describe("against a non-AD directory", () => {
    /** OpenLDAP: string entryUUID, uid instead of sAMAccountName, no UPN. */
    const OPENLDAP_ENTRY = {
      dn: "uid=dana,ou=people,dc=test,dc=local",
      entryUUID: "9F8E7D6C-5B4A-3928-1706-A5B4C3D2E1F0",
      uid: "Dana",
      cn: "Dana Cohen",
      mail: "Dana@Test.Local",
      distinguishedName: "uid=dana,ou=people,dc=test,dc=local",
    };

    function useOpenLdap() {
      vi.stubEnv("LDAP_USER_FILTER", "(objectClass=inetOrgPerson)");
      vi.stubEnv("LDAP_LOGIN_ATTRS", "uid,mail");
      vi.stubEnv("LDAP_ID_ATTR", "entryUUID");
    }

    it("authenticates using the configured attributes", async () => {
      useOpenLdap();
      ldap.state.searchEntries = [OPENLDAP_ENTRY];

      await expect(authenticate("dana", "correct-horse")).resolves.toEqual({
        ok: true,
        user: {
          // Taken as-is rather than decoded — only objectGUID is binary.
          directoryId: "9f8e7d6c-5b4a-3928-1706-a5b4c3d2e1f0",
          username: "dana",
          upn: null,
          displayName: "Dana Cohen",
          mail: "dana@test.local",
          dn: "uid=dana,ou=people,dc=test,dc=local",
        },
      });
    });

    it("builds the filter from the configured object class and attributes", async () => {
      useOpenLdap();
      await authenticate("dana", "correct-horse");

      const options = ldap.service().search.mock.calls[0]![1];
      expect(options.filter).toBe(
        "(&(objectClass=inetOrgPerson)(|(uid=dana)(mail=dana)))",
      );
    });

    it("does not request a string identifier as a buffer", async () => {
      // Asking for entryUUID as a buffer hands back its own ASCII bytes, which
      // would then be read as a 36-byte GUID and rejected.
      useOpenLdap();
      await authenticate("dana", "correct-horse");

      const options = ldap.service().search.mock.calls[0]![1];
      expect(options.explicitBufferAttributes).toEqual([]);
      expect(options.attributes).toContain("entryUUID");
      expect(options.attributes).toContain("uid");
    });

    it("still escapes the username into the configured attributes", async () => {
      useOpenLdap();
      await authenticate("admin)(objectClass=*", "correct-horse");

      const options = ldap.service().search.mock.calls[0]![1];
      expect(options.filter).toContain("(uid=admin\\29\\28objectClass=\\2a)");
    });

    it("fails cleanly when the id attribute is misconfigured", async () => {
      // Pointed at objectGUID on a directory that has no such attribute: a
      // failed login, not a crashed route.
      vi.stubEnv("LDAP_LOGIN_ATTRS", "uid");
      ldap.state.searchEntries = [OPENLDAP_ENTRY];

      await expect(authenticate("dana", "correct-horse")).resolves.toEqual({
        ok: false,
        reason: "unavailable",
      });
    });
  });

  describe("configuration", () => {
    it("refuses a plain ldap:// URL without StartTLS", async () => {
      // A simple bind over plain ldap:// puts the domain password on the wire
      // in cleartext.
      vi.stubEnv("LDAP_URL", "ldap://dc.test.local:389");

      await expect(authenticate("dana", "correct-horse")).resolves.toEqual({
        ok: false,
        reason: "unavailable",
      });
      expect(ldap.clients).toHaveLength(0);
      expect(console.error).toHaveBeenCalledWith(
        "LDAP configuration error",
        expect.objectContaining({
          message: expect.stringContaining("ldaps://"),
        }),
      );
    });

    it("allows plain ldap:// when StartTLS is enabled, and upgrades", async () => {
      vi.stubEnv("LDAP_URL", "ldap://dc.test.local:389");
      vi.stubEnv("LDAP_STARTTLS", "true");

      await authenticate("dana", "correct-horse");

      expect(ldap.service().startTLS).toHaveBeenCalled();
    });

    it("verifies the certificate by default", async () => {
      await authenticate("dana", "correct-horse");

      const options = ldap.service().options as {
        tlsOptions?: { rejectUnauthorized?: boolean };
      };
      expect(options.tlsOptions?.rejectUnauthorized).toBeUndefined();
    });

    it("skips verification only when explicitly told to", async () => {
      vi.stubEnv("LDAP_TLS_INSECURE", "true");
      vi.spyOn(console, "warn").mockImplementation(() => {});

      await authenticate("dana", "correct-horse");

      const options = ldap.service().options as {
        tlsOptions?: { rejectUnauthorized?: boolean };
      };
      expect(options.tlsOptions?.rejectUnauthorized).toBe(false);
      // Loud enough that nobody discovers this from a packet capture.
      expect(console.warn).toHaveBeenCalledWith(
        expect.stringContaining("LDAP_TLS_INSECURE"),
      );
    });

    it("refuses an empty service-account password", async () => {
      // An empty password binds anonymously; the search then returns nothing
      // and every login looks like a wrong password.
      vi.stubEnv("LDAP_BIND_PASSWORD", "");

      await expect(authenticate("dana", "correct-horse")).resolves.toEqual({
        ok: false,
        reason: "unavailable",
      });
      expect(ldap.clients).toHaveLength(0);
    });

    it.each(["LDAP_URL", "LDAP_BASE_DN", "LDAP_BIND_DN"])(
      "refuses to run without %s",
      async (name) => {
        vi.stubEnv(name, "");

        await expect(authenticate("dana", "correct-horse")).resolves.toEqual({
          ok: false,
          reason: "unavailable",
        });
        expect(ldap.clients).toHaveLength(0);
      },
    );
  });
});
