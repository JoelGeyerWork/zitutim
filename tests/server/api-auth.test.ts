import { beforeEach, describe, expect, it, vi } from "vitest";

import { POST as LOGIN } from "@/app/api/auth/login/route";
import { POST as LOGOUT } from "@/app/api/auth/logout/route";
import { getDb } from "@/lib/mongodb";
import { findUser, verifyPassword, type LdapFailureReason } from "@/lib/ldap";
import { SESSION_COOKIE, verifySessionToken } from "@/lib/session";

// The two-bind protocol is covered in ldap.test.ts; here the directory is a
// stub so the route's own ordering and failure mapping are what's under test.
vi.mock("@/lib/ldap", () => ({
  findUser: vi.fn(),
  verifyPassword: vi.fn(),
}));

const LOGIN_URL = "http://localhost:3000/api/auth/login";
const LOGOUT_URL = "http://localhost:3000/api/auth/logout";
const HOST = "localhost:3000";

const DIRECTORY_USER = {
  directoryId: "03020100-0504-0706-0809-0a0b0c0d0e0f",
  username: "dana",
  upn: "dana@test.local",
  displayName: "דנה כהן",
  mail: "dana@test.local",
  dn: "CN=Dana Cohen,OU=Users,DC=test,DC=local",
};

const mockFindUser = vi.mocked(findUser);
const mockVerifyPassword = vi.mocked(verifyPassword);

/** The directory resolves the username and accepts the password. */
function succeeds(user = DIRECTORY_USER) {
  mockFindUser.mockResolvedValue({ ok: true, user });
  mockVerifyPassword.mockResolvedValue({ ok: true });
}

/** The username resolves, but the bind is rejected. */
function bindFails(reason: LdapFailureReason, user = DIRECTORY_USER) {
  mockFindUser.mockResolvedValue({ ok: true, user });
  mockVerifyPassword.mockResolvedValue({ ok: false, reason });
}

/** The username matches nothing. */
function notFound() {
  mockFindUser.mockResolvedValue({ ok: false, reason: "credentials" });
}

function login(payload: unknown, init: RequestInit = {}) {
  return LOGIN(
    new Request(LOGIN_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        // Servers see a Host header on every request; `new Request` does not
        // add one, and the same-origin check compares against it.
        host: HOST,
        ...init.headers,
      },
      body: typeof payload === "string" ? payload : JSON.stringify(payload),
    }),
  );
}

const CREDENTIALS = { username: "dana", password: "correct-horse" };

/** Parses the Set-Cookie header into { value, ...attributes }. */
function setCookie(response: Response) {
  const header = response.headers.get("set-cookie");
  if (!header) return null;

  const [pair, ...rest] = header.split(";");
  const attributes = Object.fromEntries(
    rest.map((part) => {
      const [key, value] = part.split("=");
      return [key!.trim().toLowerCase(), value?.trim() ?? true];
    }),
  );
  return { value: pair!.slice(pair!.indexOf("=") + 1), attributes, header };
}

beforeEach(async () => {
  const db = await getDb();
  // fileParallelism is off and the in-memory Mongo is shared, so stale counters
  // from another file would silently change the throttle results here.
  await Promise.all([
    db.collection("users").deleteMany({}),
    db.collection("login_attempts").deleteMany({}),
  ]);
  vi.clearAllMocks();
  vi.unstubAllEnvs();
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  succeeds();
});

describe("POST /api/auth/login", () => {
  it("signs the user in and sets a session cookie", async () => {
    const response = await login(CREDENTIALS);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      user: {
        id: expect.stringMatching(/^[0-9a-f]{24}$/),
        name: "דנה כהן",
        username: "dana",
      },
    });

    const cookie = setCookie(response)!;
    await expect(verifySessionToken(cookie.value)).resolves.toMatchObject({
      name: "דנה כהן",
      username: "dana",
    });
  });

  it("resolves the user before ever attempting a bind", async () => {
    // The search runs as the service account and never touches badPwdCount, so
    // it is what tells us which throttle bucket the attempt belongs to.
    await login(CREDENTIALS);

    expect(mockFindUser.mock.invocationCallOrder[0]).toBeLessThan(
      mockVerifyPassword.mock.invocationCallOrder[0]!,
    );
  });

  it("marks the cookie HttpOnly, Lax and path-wide", async () => {
    const cookie = setCookie(await login(CREDENTIALS))!;

    expect(cookie.header.toLowerCase()).toContain("httponly");
    expect(cookie.attributes.samesite).toBe("lax");
    expect(cookie.attributes.path).toBe("/");
    expect(cookie.attributes.domain).toBeUndefined();
  });

  it("tells proxies not to cache the response", async () => {
    const response = await login(CREDENTIALS);
    expect(response.headers.get("cache-control")).toBe("no-store");
  });

  it("creates the user record once across repeated logins", async () => {
    await login(CREDENTIALS);
    await login(CREDENTIALS);

    const db = await getDb();
    expect(await db.collection("users").countDocuments()).toBe(1);
  });

  it("returns 400 for malformed JSON", async () => {
    const response = await login("{not json");
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: "בקשה לא תקינה" });
  });

  it("returns 422 with per-field Hebrew messages", async () => {
    const response = await login({ username: "", password: "" });

    expect(response.status).toBe(422);
    const payload = await response.json();
    expect(payload.error).toBe("יש שדות לא תקינים");
    expect(payload.issues).toEqual({
      username: "צריך שם משתמש",
      password: "צריך סיסמה",
    });
    // Validation failing must not have cost a directory round trip.
    expect(mockFindUser).not.toHaveBeenCalled();
  });

  it("rejects a cross-origin request with 403", async () => {
    const response = await login(CREDENTIALS, {
      headers: { origin: "https://evil.example" },
    });

    expect(response.status).toBe(403);
    expect(mockFindUser).not.toHaveBeenCalled();
  });

  it("allows a same-origin request", async () => {
    const response = await login(CREDENTIALS, {
      headers: { origin: `http://${HOST}` },
    });

    expect(response.status).toBe(200);
  });

  it("allows a request whose Host is not the server's own bind address", async () => {
    // The production case: Next builds request.url from the server's bind
    // address (the Dockerfile sets HOSTNAME=0.0.0.0), so comparing Origin
    // against it 403s every real browser. The Host header is what the client
    // actually asked for.
    const response = await LOGIN(
      new Request("http://0.0.0.0:3000/api/auth/login", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          host: "zitutim.corp",
          origin: "https://zitutim.corp",
        },
        body: JSON.stringify(CREDENTIALS),
      }),
    );

    expect(response.status).toBe(200);
  });

  it("prefers X-Forwarded-Host, which is what a proxy rewrites", async () => {
    const response = await LOGIN(
      new Request("http://0.0.0.0:3000/api/auth/login", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          host: "internal-service:3000",
          "x-forwarded-host": "zitutim.corp",
          origin: "https://zitutim.corp",
        },
        body: JSON.stringify(CREDENTIALS),
      }),
    );

    expect(response.status).toBe(200);
  });

  it("gives an identical answer for an unknown user and a wrong password", async () => {
    // These now take different code paths — one fails at the search, the other
    // at the bind — so any difference between them is an enumeration oracle.
    notFound();
    const unknown = await login({ username: "nobody", password: "x" });
    const unknownBody = await unknown.json();

    bindFails("credentials");
    const wrong = await login({ username: "dana", password: "wrong" });
    const wrongBody = await wrong.json();

    expect(unknown.status).toBe(wrong.status);
    expect(unknownBody).toEqual(wrongBody);
    expect(unknownBody).toEqual({ error: "שם המשתמש או הסיסמה שגויים" });
  });

  it.each([
    ["password-expired", 401, "הסיסמה פגה. צריך להחליף אותה בחלונות ואז להתחבר שוב"],
    ["must-change-password", 401, "צריך להחליף סיסמה בחלונות לפני הכניסה הראשונה"],
    ["locked", 401, "החשבון נעול. כדאי לפנות לתמיכה או לחכות לשחרור הנעילה"],
    ["unavailable", 503, "לא הצלחנו להתחבר לשרת ההזדהות"],
  ] as const)("maps %s to %i", async (reason, status, message) => {
    bindFails(reason);

    const response = await login(CREDENTIALS);

    expect(response.status).toBe(status);
    await expect(response.json()).resolves.toEqual({ error: message });
    expect(response.headers.get("set-cookie")).toBeNull();
  });

  it("reports a directory that cannot be reached at all as unavailable", async () => {
    mockFindUser.mockResolvedValue({ ok: false, reason: "unavailable" });

    const response = await login(CREDENTIALS);

    expect(response.status).toBe(503);
    expect(mockVerifyPassword).not.toHaveBeenCalled();
  });

  it("holds failures open to the configured floor", async () => {
    // Without this, failing at the search is measurably faster than failing at
    // the bind — a working timing oracle for which usernames exist.
    vi.stubEnv("LOGIN_MIN_RESPONSE_MS", "120");
    bindFails("credentials");

    const startedAt = Date.now();
    await login(CREDENTIALS);

    expect(Date.now() - startedAt).toBeGreaterThanOrEqual(115);
  });

  it("never logs the request body", async () => {
    bindFails("credentials");
    await login({ username: "dana", password: "hunter2" });

    const logged = [
      ...vi.mocked(console.warn).mock.calls,
      ...vi.mocked(console.error).mock.calls,
    ]
      .flat()
      .map(String)
      .join(" ");
    // The body carries a domain password.
    expect(logged).not.toContain("hunter2");
  });
});

describe("login throttling", () => {
  it("stops binding once the limit is reached", async () => {
    // This is the assertion that keeps the app from locking real employees out
    // of Windows: after the limit, no further bind reaches the directory.
    bindFails("credentials");

    for (let i = 0; i < 3; i += 1) {
      expect((await login(CREDENTIALS)).status).toBe(401);
    }
    expect(mockVerifyPassword).toHaveBeenCalledTimes(3);

    const blocked = await login(CREDENTIALS);

    expect(blocked.status).toBe(429);
    expect(mockVerifyPassword).toHaveBeenCalledTimes(3);
    await expect(blocked.json()).resolves.toEqual({
      error: "יותר מדי ניסיונות. כדאי לנסות שוב בעוד כמה דקות",
    });
    expect(Number(blocked.headers.get("retry-after"))).toBeGreaterThan(0);
  });

  it("shares one budget across every alias of the same account", async () => {
    // LDAP_LOGIN_ATTRS matches several attributes for one object, so a bucket
    // per typed string would give "dana" and "dana@test.local" three binds
    // each — six against one account, past the lockout threshold.
    bindFails("credentials");

    for (let i = 0; i < 3; i += 1) {
      expect((await login(CREDENTIALS)).status).toBe(401);
    }

    const byUpn = await login({
      username: "dana@test.local",
      password: "wrong",
    });

    expect(byUpn.status).toBe(429);
    expect(mockVerifyPassword).toHaveBeenCalledTimes(3);
  });

  it("throttles per account, not globally", async () => {
    bindFails("credentials");
    for (let i = 0; i < 4; i += 1) await login(CREDENTIALS);

    succeeds({
      ...DIRECTORY_USER,
      directoryId: "ffffffff-0000-1111-2222-333344445555",
      username: "omer",
    });
    const other = await login({ username: "omer", password: "x" });

    expect(other.status).toBe(200);
  });

  it("clears the counter after a successful login", async () => {
    bindFails("credentials");
    await login(CREDENTIALS);
    await login(CREDENTIALS);

    succeeds();
    expect((await login(CREDENTIALS)).status).toBe(200);

    bindFails("credentials");
    // Back to a full budget rather than one attempt from a lockout.
    for (let i = 0; i < 3; i += 1) {
      expect((await login(CREDENTIALS)).status).toBe(401);
    }
  });

  it("does not spend the budget on a directory outage", async () => {
    // The user did nothing wrong; a DC being down must not push them toward a
    // lockout they can't do anything about.
    bindFails("unavailable");
    for (let i = 0; i < 5; i += 1) {
      expect((await login(CREDENTIALS)).status).toBe(503);
    }

    expect(mockVerifyPassword).toHaveBeenCalledTimes(5);
  });
});

describe("POST /api/auth/logout", () => {
  it("expires the session cookie", async () => {
    const response = await LOGOUT(new Request(LOGOUT_URL, { method: "POST" }));

    expect(response.status).toBe(204);
    const header = response.headers.get("set-cookie")!;
    expect(header).toContain(`${SESSION_COOKIE}=`);
    expect(header.toLowerCase()).toContain("max-age=0");
  });

  it("rejects a cross-origin logout", async () => {
    const response = await LOGOUT(
      new Request(LOGOUT_URL, {
        method: "POST",
        headers: { host: HOST, origin: "https://evil.example" },
      }),
    );

    expect(response.status).toBe(403);
  });
});
