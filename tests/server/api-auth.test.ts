import { beforeEach, describe, expect, it, vi } from "vitest";

import { POST as LOGIN } from "@/app/api/auth/login/route";
import { POST as LOGOUT } from "@/app/api/auth/logout/route";
import { getDb } from "@/lib/mongodb";
import { authenticate, type LdapResult } from "@/lib/ldap";
import { SESSION_COOKIE, verifySessionToken } from "@/lib/session";

// The two-bind protocol is covered in ldap.test.ts; here the directory is a
// stub so the route's own ordering and failure mapping are what's under test.
vi.mock("@/lib/ldap", () => ({ authenticate: vi.fn() }));

const LOGIN_URL = "http://localhost:3000/api/auth/login";
const LOGOUT_URL = "http://localhost:3000/api/auth/logout";

const DIRECTORY_USER = {
  directoryId: "03020100-0504-0706-0809-0a0b0c0d0e0f",
  username: "dana",
  upn: "dana@test.local",
  displayName: "דנה כהן",
  mail: "dana@test.local",
  dn: "CN=Dana Cohen,OU=Users,DC=test,DC=local",
};

const mockAuthenticate = vi.mocked(authenticate);

function succeeds() {
  mockAuthenticate.mockResolvedValue({ ok: true, user: DIRECTORY_USER });
}

function fails(reason: Exclude<LdapResult & { ok: false }, never>["reason"]) {
  mockAuthenticate.mockResolvedValue({ ok: false, reason });
}

function login(payload: unknown, init: RequestInit = {}) {
  return LOGIN(
    new Request(LOGIN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...init.headers },
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
    // Validation failing must not have cost a bind.
    expect(mockAuthenticate).not.toHaveBeenCalled();
  });

  it("rejects a cross-origin request with 403", async () => {
    const response = await login(CREDENTIALS, {
      headers: { origin: "https://evil.example" },
    });

    expect(response.status).toBe(403);
    expect(mockAuthenticate).not.toHaveBeenCalled();
  });

  it("allows a same-origin request", async () => {
    const response = await login(CREDENTIALS, {
      headers: { origin: "http://localhost:3000" },
    });

    expect(response.status).toBe(200);
  });

  it("gives an identical answer for an unknown user and a wrong password", async () => {
    // Any difference here is an account-enumeration oracle.
    fails("credentials");
    const unknown = await login({ username: "nobody", password: "x" });
    const unknownBody = await unknown.json();

    fails("credentials");
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
    fails(reason);

    const response = await login(CREDENTIALS);

    expect(response.status).toBe(status);
    await expect(response.json()).resolves.toEqual({ error: message });
    expect(response.headers.get("set-cookie")).toBeNull();
  });

  it("holds failures open to the configured floor", async () => {
    // Without this, a nonexistent username fails at the search in ~5ms and a
    // real one at the bind in ~50ms — a working timing oracle.
    vi.stubEnv("LOGIN_MIN_RESPONSE_MS", "120");
    fails("credentials");

    const startedAt = Date.now();
    await login(CREDENTIALS);

    expect(Date.now() - startedAt).toBeGreaterThanOrEqual(115);
  });

  it("never logs the request body", async () => {
    fails("credentials");
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
  it("stops calling the directory once the username limit is reached", async () => {
    // This is the assertion that keeps the app from locking real employees out
    // of Windows: after the limit, no further bind reaches AD at all.
    fails("credentials");

    for (let i = 0; i < 3; i += 1) {
      expect((await login(CREDENTIALS)).status).toBe(401);
    }
    expect(mockAuthenticate).toHaveBeenCalledTimes(3);

    const blocked = await login(CREDENTIALS);

    expect(blocked.status).toBe(429);
    expect(mockAuthenticate).toHaveBeenCalledTimes(3);
    await expect(blocked.json()).resolves.toEqual({
      error: "יותר מדי ניסיונות. כדאי לנסות שוב בעוד כמה דקות",
    });
    expect(Number(blocked.headers.get("retry-after"))).toBeGreaterThan(0);
  });

  it("throttles per username, not globally", async () => {
    fails("credentials");
    for (let i = 0; i < 3; i += 1) await login(CREDENTIALS);

    succeeds();
    const other = await login({ username: "omer", password: "x" });

    expect(other.status).toBe(200);
  });

  it("clears the counter after a successful login", async () => {
    fails("credentials");
    await login(CREDENTIALS);
    await login(CREDENTIALS);

    succeeds();
    expect((await login(CREDENTIALS)).status).toBe(200);

    fails("credentials");
    // Back to a full budget rather than one attempt from a lockout.
    for (let i = 0; i < 3; i += 1) {
      expect((await login(CREDENTIALS)).status).toBe(401);
    }
  });

  it("does not spend the budget on a directory outage", async () => {
    // The user did nothing wrong; a DC being down must not push them toward a
    // lockout they can't do anything about.
    fails("unavailable");
    for (let i = 0; i < 5; i += 1) {
      expect((await login(CREDENTIALS)).status).toBe(503);
    }

    expect(mockAuthenticate).toHaveBeenCalledTimes(5);
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
        headers: { origin: "https://evil.example" },
      }),
    );

    expect(response.status).toBe(403);
  });
});
