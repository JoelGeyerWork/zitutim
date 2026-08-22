import { ObjectId } from "mongodb";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { type DirectoryPerson } from "@/lib/directory-schema";
import { getDb } from "@/lib/mongodb";
import { sessionCookie } from "./factories";

// The routes' only directory calls. Everything else — the users upsert, the
// rotation store — is the real thing against the in-memory Mongo.
vi.mock("@/lib/ldap", () => ({
  findPersonById: vi.fn(),
  findPeople: vi.fn(),
}));

import { findPeople, findPersonById } from "@/lib/ldap";
import { GET as GET_DIRECTORY } from "@/app/api/directory/route";
import { GET as GET_ROTATION, POST } from "@/app/api/rotation/route";
import { DELETE, PATCH } from "@/app/api/rotation/[userId]/route";
import { PUT } from "@/app/api/rotation/order/route";

const mockFindPersonById = vi.mocked(findPersonById);
const mockFindPeople = vi.mocked(findPeople);

const BASE = "http://localhost:3000/api/rotation";
const DIRECTORY_URL = "http://localhost:3000/api/directory";

/** The directory the mocked lookups answer from, keyed on directoryId. */
const DIRECTORY: Record<string, DirectoryPerson> = {
  "guid-noa": { directoryId: "guid-noa", displayName: "נועה ברקת", title: "ראשת צוות", username: "noa.bareket" },
  "guid-itay": { directoryId: "guid-itay", displayName: "איתי שרון", title: "שרת", username: "itay.sharon" },
  "guid-shira": { directoryId: "guid-shira", displayName: "שירה לוי", title: "לקוח", username: "shira.levi" },
};

async function mutate(
  url: string,
  method: string,
  payload?: unknown,
  cookie: string | null | undefined = undefined,
) {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  const value = cookie === undefined ? await sessionCookie() : cookie;
  if (value) headers.cookie = value;

  return new Request(url, {
    method,
    headers,
    body:
      payload === undefined
        ? undefined
        : typeof payload === "string"
          ? payload
          : JSON.stringify(payload),
  });
}

async function post(payload: unknown, cookie?: string | null) {
  return POST(await mutate(BASE, "POST", payload, cookie));
}

function params(userId: string) {
  return { params: Promise.resolve({ userId }) };
}

async function del(userId: string, cookie?: string | null) {
  return DELETE(
    await mutate(`${BASE}/${userId}`, "DELETE", undefined, cookie),
    params(userId),
  );
}

async function patch(userId: string, payload: unknown, cookie?: string | null) {
  return PATCH(
    await mutate(`${BASE}/${userId}`, "PATCH", payload, cookie),
    params(userId),
  );
}

async function order(payload: unknown, cookie?: string | null) {
  return PUT(await mutate(`${BASE}/order`, "PUT", payload, cookie));
}

/** Add someone through the real POST path and return their users._id. */
async function add(directoryId: string, gender: "m" | "f" = "f"): Promise<string> {
  const response = await post({ directoryId, gender });
  expect(response.status).toBe(201);
  const { member } = await response.json();
  return member.userId as string;
}

beforeEach(async () => {
  const db = await getDb();
  await db.collection("rotation").deleteMany({});
  await db.collection("users").deleteMany({});

  mockFindPersonById.mockReset();
  mockFindPersonById.mockImplementation(async (id: string) => DIRECTORY[id] ?? null);
  mockFindPeople.mockReset();
  mockFindPeople.mockResolvedValue([]);
});

describe("GET /api/rotation", () => {
  it("is public and returns members as { userId, name, title, gender }, no directoryId", async () => {
    const noaId = await add("guid-noa", "f");

    const response = await GET_ROTATION();
    expect(response.status).toBe(200);
    const { members } = await response.json();
    expect(members).toEqual([
      { userId: noaId, name: "נועה ברקת", title: "ראשת צוות", gender: "f" },
    ]);
  });
});

describe("POST /api/rotation", () => {
  it("re-resolves the person and ignores names in the body", async () => {
    const response = await post({
      directoryId: "guid-noa",
      gender: "f",
      // All ignored — the schema strips them and the lookup is the authority.
      displayName: "מתחזה",
      name: "מתחזה",
      title: "מתחזה",
    });

    expect(response.status).toBe(201);
    const { member } = await response.json();
    expect(member.name).toBe("נועה ברקת");
    expect(member.title).toBe("ראשת צוות");

    // And what was stored resolves to the directory name, not the body's.
    const list = await (await GET_ROTATION()).json();
    expect(list.members[0].name).toBe("נועה ברקת");
  });

  it("returns 422 for an unknown directoryId", async () => {
    const response = await post({ directoryId: "guid-nobody", gender: "m" });
    expect(response.status).toBe(422);
    await expect(response.json()).resolves.toMatchObject({
      issues: { directoryId: expect.any(String) },
    });

    const db = await getDb();
    await expect(db.collection("rotation").countDocuments()).resolves.toBe(0);
  });

  it("returns 422 for a missing gender", async () => {
    const response = await post({ directoryId: "guid-noa" });
    expect(response.status).toBe(422);
  });

  it("returns 409 when the person is already in the rotation", async () => {
    await add("guid-noa");
    const again = await post({ directoryId: "guid-noa", gender: "m" });
    expect(again.status).toBe(409);
    await expect(again.json()).resolves.toMatchObject({ error: "כבר בסבב" });
  });
});

describe("DELETE /api/rotation/:userId", () => {
  it("removes a member and returns 204", async () => {
    await add("guid-noa");
    const itayId = await add("guid-itay");

    const response = await del(itayId);
    expect(response.status).toBe(204);
    await expect(response.text()).resolves.toBe("");

    const list = await (await GET_ROTATION()).json();
    expect(list.members).toHaveLength(1);
  });

  it("refuses to remove the last member with 409", async () => {
    const noaId = await add("guid-noa");
    const response = await del(noaId);
    expect(response.status).toBe(409);
    // Still there.
    const list = await (await GET_ROTATION()).json();
    expect(list.members).toHaveLength(1);
  });

  it("returns 404 for an unknown or malformed id", async () => {
    await add("guid-noa");
    expect((await del(new ObjectId().toHexString())).status).toBe(404);
    expect((await del("nope")).status).toBe(404);
  });
});

describe("PATCH /api/rotation/:userId", () => {
  it("updates the gender and 404s for someone absent", async () => {
    const noaId = await add("guid-noa", "f");
    const response = await patch(noaId, { gender: "m" });
    expect(response.status).toBe(200);

    const list = await (await GET_ROTATION()).json();
    expect(list.members[0].gender).toBe("m");

    expect((await patch(new ObjectId().toHexString(), { gender: "m" })).status).toBe(404);
  });

  it("returns 422 for a bad gender", async () => {
    const noaId = await add("guid-noa");
    expect((await patch(noaId, { gender: "x" })).status).toBe(422);
  });
});

describe("PUT /api/rotation/order", () => {
  it("stores a valid set densely", async () => {
    const a = await add("guid-noa");
    const b = await add("guid-itay");
    const c = await add("guid-shira");

    const response = await order({ ids: [c, a, b] });
    expect(response.status).toBe(200);

    const list = await (await GET_ROTATION()).json();
    expect(list.members.map((member: { userId: string }) => member.userId)).toEqual([c, a, b]);
  });

  it("rejects a duplicate/stale set with 422 and writes nothing", async () => {
    const a = await add("guid-noa");
    const b = await add("guid-itay");
    const c = await add("guid-shira");

    const response = await order({ ids: [a, a, b] });
    expect(response.status).toBe(422);

    // Untouched: still insertion order.
    const list = await (await GET_ROTATION()).json();
    expect(list.members.map((member: { userId: string }) => member.userId)).toEqual([a, b, c]);
  });
});

describe("GET /api/directory", () => {
  it("requires a session", async () => {
    const anon = new Request(`${DIRECTORY_URL}?q=noa`);
    const response = await GET_DIRECTORY(anon);
    expect(response.status).toBe(401);
    expect(mockFindPeople).not.toHaveBeenCalled();
  });

  it("returns people for a signed-in caller", async () => {
    mockFindPeople.mockResolvedValue([DIRECTORY["guid-noa"]]);

    const request = await mutate(`${DIRECTORY_URL}?q=noa`, "GET");
    const response = await GET_DIRECTORY(request);
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      people: [DIRECTORY["guid-noa"]],
    });
  });

  it("answers a query under two characters without a directory call", async () => {
    const request = await mutate(`${DIRECTORY_URL}?q=n`, "GET");
    const response = await GET_DIRECTORY(request);
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ people: [] });
    expect(mockFindPeople).not.toHaveBeenCalled();
  });
});

describe("authentication and origin", () => {
  const UNAUTHORIZED = { error: "צריך להתחבר כדי לשנות את הקיר" };

  it("rejects POST without a session, before parsing the body", async () => {
    // Session precedes parse: a malformed body still answers 401, not 400/422.
    expect((await post({ directoryId: "guid-noa", gender: "f" }, null)).status).toBe(401);
    expect((await post("{not json", null)).status).toBe(401);
    await expect(post({ directoryId: "guid-noa", gender: "f" }, null).then((r) => r.json())).resolves.toEqual(
      UNAUTHORIZED,
    );
  });

  it("rejects DELETE, PATCH and PUT /order without a session", async () => {
    const noaId = await add("guid-noa");
    expect((await del(noaId, null)).status).toBe(401);
    expect((await patch(noaId, { gender: "m" }, null)).status).toBe(401);
    expect((await order({ ids: [noaId] }, null)).status).toBe(401);
  });

  it("rejects a cross-origin POST even with a valid session", async () => {
    const response = await POST(
      new Request(BASE, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          cookie: await sessionCookie(),
          origin: "https://evil.example",
        },
        body: JSON.stringify({ directoryId: "guid-noa", gender: "f" }),
      }),
    );
    expect(response.status).toBe(403);

    const db = await getDb();
    await expect(db.collection("rotation").countDocuments()).resolves.toBe(0);
  });
});
