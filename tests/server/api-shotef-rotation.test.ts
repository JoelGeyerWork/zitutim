import { ObjectId } from "mongodb";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { type DirectoryPerson } from "@/lib/directory-schema";
import { getDb } from "@/lib/mongodb";
import { sessionCookie } from "./factories";

// The routes' only directory call. Everything else — the users upsert, the
// rotation store — is the real thing against the in-memory Mongo.
vi.mock("@/lib/ldap", () => ({
  findPersonById: vi.fn(),
  findPeople: vi.fn(),
}));

import { findPersonById } from "@/lib/ldap";
import { GET as GET_MEETUP } from "@/app/api/rotation/route";
import { GET, POST } from "@/app/api/shotef/rotation/route";
import { DELETE, PATCH } from "@/app/api/shotef/rotation/[userId]/route";
import { PUT } from "@/app/api/shotef/rotation/order/route";

const mockFindPersonById = vi.mocked(findPersonById);

const BASE = "http://localhost:3000/api/shotef/rotation";

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

async function members() {
  const { members: list } = await (await GET()).json();
  return list as { userId: string; name: string; title: string; gender: string }[];
}

beforeEach(async () => {
  const db = await getDb();
  await db.collection("rotation").deleteMany({});
  await db.collection("users").deleteMany({});

  mockFindPersonById.mockReset();
  mockFindPersonById.mockImplementation(async (id: string) => DIRECTORY[id] ?? null);
});

describe("GET /api/shotef/rotation", () => {
  it("is public and returns members as { userId, name, title, gender }, no directoryId", async () => {
    const noaId = await add("guid-noa", "f");

    const response = await GET();
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      members: [
        { userId: noaId, name: "נועה ברקת", title: "ראשת צוות", gender: "f" },
      ],
    });
  });

  // The two rotations are one collection behind a key, so the thing worth
  // proving at the route boundary is that they are still two lists.
  it("does not answer with the meetup rotation's members", async () => {
    await add("guid-noa");

    const meetup = await (await GET_MEETUP()).json();
    expect(meetup.members).toEqual([]);
  });
});

describe("POST /api/shotef/rotation", () => {
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
    expect(await members()).toEqual([expect.objectContaining({ name: "נועה ברקת" })]);
  });

  it("returns 422 for an unknown directoryId and writes nothing", async () => {
    const response = await post({ directoryId: "guid-nobody", gender: "m" });
    expect(response.status).toBe(422);
    await expect(response.json()).resolves.toMatchObject({
      issues: { directoryId: expect.any(String) },
    });

    const db = await getDb();
    await expect(db.collection("rotation").countDocuments()).resolves.toBe(0);
  });

  it("returns 422 for a missing gender", async () => {
    expect((await post({ directoryId: "guid-noa" })).status).toBe(422);
  });

  it("returns 409 when the person is already on the rotation", async () => {
    await add("guid-noa");
    const again = await post({ directoryId: "guid-noa", gender: "m" });
    expect(again.status).toBe(409);
    await expect(again.json()).resolves.toMatchObject({ error: "כבר בתורנות" });
  });

  it("reports a directory outage as 503, not as bad input", async () => {
    mockFindPersonById.mockRejectedValueOnce(new Error("ECONNREFUSED"));
    expect((await post({ directoryId: "guid-noa", gender: "f" })).status).toBe(503);
  });
});

describe("DELETE /api/shotef/rotation/:userId", () => {
  it("removes a member and returns 204", async () => {
    await add("guid-noa");
    const itayId = await add("guid-itay");

    const response = await del(itayId);
    expect(response.status).toBe(204);
    await expect(response.text()).resolves.toBe("");
    expect(await members()).toHaveLength(1);
  });

  it("refuses to remove the last member with 409", async () => {
    const noaId = await add("guid-noa");
    const response = await del(noaId);
    expect(response.status).toBe(409);
    expect(await members()).toHaveLength(1);
  });

  it("returns 404 for an unknown or malformed id", async () => {
    await add("guid-noa");
    expect((await del(new ObjectId().toHexString())).status).toBe(404);
    expect((await del("nope")).status).toBe(404);
  });
});

describe("PATCH /api/shotef/rotation/:userId", () => {
  it("updates the gender and 404s for someone absent", async () => {
    const noaId = await add("guid-noa", "f");
    expect((await patch(noaId, { gender: "m" })).status).toBe(200);
    expect((await members())[0].gender).toBe("m");

    expect((await patch(new ObjectId().toHexString(), { gender: "m" })).status).toBe(404);
  });

  it("returns 422 for a bad gender", async () => {
    const noaId = await add("guid-noa");
    expect((await patch(noaId, { gender: "x" })).status).toBe(422);
  });
});

describe("PUT /api/shotef/rotation/order", () => {
  it("stores a valid set verbatim", async () => {
    const a = await add("guid-noa");
    const b = await add("guid-itay");
    const c = await add("guid-shira");

    expect((await order({ ids: [c, a, b] })).status).toBe(200);
    expect((await members()).map((member) => member.userId)).toEqual([c, a, b]);
  });

  it("rejects a duplicate/stale set with 422 and writes nothing", async () => {
    const a = await add("guid-noa");
    const b = await add("guid-itay");
    const c = await add("guid-shira");

    expect((await order({ ids: [a, a, b] })).status).toBe(422);
    expect((await members()).map((member) => member.userId)).toEqual([a, b, c]);
  });
});

describe("authentication and origin", () => {
  const UNAUTHORIZED = { error: "צריך להתחבר כדי לשנות את הקיר" };

  it("rejects POST without a session, before parsing the body", async () => {
    // Session precedes parse: a malformed body still answers 401, not 400/422.
    expect((await post({ directoryId: "guid-noa", gender: "f" }, null)).status).toBe(401);
    expect((await post("{not json", null)).status).toBe(401);
    await expect(
      post({ directoryId: "guid-noa", gender: "f" }, null).then((r) => r.json()),
    ).resolves.toEqual(UNAUTHORIZED);
    // And the unmetered directory lookup never ran for an anonymous caller.
    expect(mockFindPersonById).not.toHaveBeenCalled();
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
