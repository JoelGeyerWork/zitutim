import { beforeEach, describe, expect, it, vi } from "vitest";

import { ConfigError } from "@/lib/config-error";
import { type DirectoryPerson } from "@/lib/directory-schema";
import { getDb } from "@/lib/mongodb";
import { directoryRef, userRef } from "@/lib/person-ref";
import { upsertRosterUser } from "@/lib/users";

vi.mock("@/lib/ldap", () => ({
  findPersonById: vi.fn(),
  findPeople: vi.fn(),
}));

import { findPersonById } from "@/lib/ldap";
import { resolvePeople } from "@/lib/people";

const mockFindPersonById = vi.mocked(findPersonById);

/** Two the app already holds, and one it has only ever heard of from AD. */
const KNOWN: DirectoryPerson[] = [
  { directoryId: "guid-ori", displayName: "אורי בן־חיים", title: "דאטה", username: "ori.benhaim" },
  { directoryId: "guid-daniel", displayName: "דניאל עמר", title: "תשתיות", username: "daniel.amar" },
];

const STRANGER: DirectoryPerson = {
  directoryId: "guid-roi",
  displayName: "רועי אשכנזי",
  title: "אבטחת מידע",
  username: "roi.ashkenazi",
};

let userId: Record<string, string>;

beforeEach(async () => {
  const db = await getDb();
  await db.collection("users").deleteMany({});

  userId = {};
  for (const person of KNOWN) {
    userId[person.displayName] = await upsertRosterUser(person);
  }

  mockFindPersonById.mockReset();
});

describe("resolvePeople", () => {
  it("resolves user references in the order they were given", async () => {
    const result = await resolvePeople([
      userRef(userId["דניאל עמר"]),
      userRef(userId["אורי בן־חיים"]),
    ]);

    expect(result.ok && result.people.map((person) => person.name)).toEqual([
      "דניאל עמר",
      "אורי בן־חיים",
    ]);
  });

  // The availability rule, and the reason `PersonRef` has a `user` arm at all:
  // there is no domain controller on this network, and naming somebody the app
  // already holds has to go on working without one.
  it("never opens a directory lookup for user references alone", async () => {
    mockFindPersonById.mockRejectedValue(new Error("directory unavailable"));

    const result = await resolvePeople([userRef(userId["אורי בן־חיים"])]);

    expect(result.ok).toBe(true);
    expect(mockFindPersonById).not.toHaveBeenCalled();
  });

  it("writes a users row for somebody the app has never seen", async () => {
    mockFindPersonById.mockResolvedValue(STRANGER);

    const result = await resolvePeople([directoryRef("guid-roi")]);
    expect(result.ok && result.people).toEqual([
      { id: expect.stringMatching(/^[a-f0-9]{24}$/), name: "רועי אשכנזי" },
    ]);

    const db = await getDb();
    const row = await db.collection("users").findOne({ directoryId: "guid-roi" });
    expect(row!.displayName).toBe("רועי אשכנזי");
  });

  // Re-resolving is what keeps a client's typing out of a stored name: only the
  // id crosses the wire, and the row is written from what the directory says.
  it("takes the name from the directory, never from the reference", async () => {
    mockFindPersonById.mockResolvedValue(STRANGER);

    const result = await resolvePeople([directoryRef("guid-roi")]);

    expect(mockFindPersonById).toHaveBeenCalledWith("guid-roi");
    expect(result.ok && result.people[0].name).toBe("רועי אשכנזי");
  });

  it("lands a directory reference on the existing row, not a second one", async () => {
    mockFindPersonById.mockResolvedValue(KNOWN[0]);

    const result = await resolvePeople([directoryRef("guid-ori")]);

    expect(result.ok && result.people[0].id).toBe(userId["אורי בן־חיים"]);
    const db = await getDb();
    expect(
      await db.collection("users").countDocuments({ directoryId: "guid-ori" }),
    ).toBe(1);
  });

  // `dedupeRefs` cannot see this one: two different references, one person.
  // Only this function ever learns that the GUID resolves to that row.
  it("folds together one person named through both sources", async () => {
    mockFindPersonById.mockResolvedValue(KNOWN[0]);

    const result = await resolvePeople([
      userRef(userId["אורי בן־חיים"]),
      directoryRef("guid-ori"),
    ]);

    expect(result.ok && result.people).toEqual([
      { id: userId["אורי בן־חיים"], name: "אורי בן־חיים" },
    ]);
  });

  it("reports a user id that resolves to nobody as bad input", async () => {
    const result = await resolvePeople([
      userRef(userId["אורי בן־חיים"]),
      userRef("6b00000000000000000000ff"),
    ]);

    expect(result).toEqual({ ok: false, reason: "unknown" });
  });

  it("reports a malformed user id instead of throwing on the ObjectId", async () => {
    await expect(resolvePeople([userRef("not-an-object-id")])).resolves.toEqual({
      ok: false,
      reason: "unknown",
    });
  });

  it("reports a directoryId that resolves to nobody as bad input", async () => {
    mockFindPersonById.mockResolvedValue(null);

    await expect(resolvePeople([directoryRef("guid-nobody")])).resolves.toEqual({
      ok: false,
      reason: "unknown",
    });
  });

  // Checked before any directory row is written, so a request that is going to
  // be refused does not leave a new `users` row behind it.
  it("refuses an unknown user id without resolving the directory half", async () => {
    mockFindPersonById.mockResolvedValue(STRANGER);

    const result = await resolvePeople([
      userRef("6b00000000000000000000ff"),
      directoryRef("guid-roi"),
    ]);

    expect(result).toEqual({ ok: false, reason: "unknown" });
    expect(mockFindPersonById).not.toHaveBeenCalled();

    const db = await getDb();
    expect(
      await db.collection("users").countDocuments({ directoryId: "guid-roi" }),
    ).toBe(0);
  });

  it("tells a directory outage apart from a server that was never configured", async () => {
    mockFindPersonById.mockRejectedValue(new Error("directory unavailable"));
    await expect(resolvePeople([directoryRef("guid-roi")])).resolves.toEqual({
      ok: false,
      reason: "unavailable",
    });

    mockFindPersonById.mockRejectedValue(new ConfigError("LDAP_URL is not set"));
    await expect(resolvePeople([directoryRef("guid-roi")])).resolves.toEqual({
      ok: false,
      reason: "misconfigured",
    });
  });

  it("answers an empty list for nothing at all", async () => {
    await expect(resolvePeople([])).resolves.toEqual({ ok: true, people: [] });
  });
});
