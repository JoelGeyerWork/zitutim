import { beforeEach, describe, expect, it } from "vitest";

import { getDb } from "@/lib/mongodb";
import { type DirectoryUser } from "@/lib/ldap";
import { getUser, upsertUserFromDirectory, type UserDoc } from "@/lib/users";

const DANA: DirectoryUser = {
  directoryId: "03020100-0504-0706-0809-0a0b0c0d0e0f",
  username: "dana",
  upn: "dana@test.local",
  displayName: "דנה כהן",
  mail: "dana@test.local",
  dn: "CN=Dana Cohen,OU=Users,DC=test,DC=local",
};

async function collection() {
  const db = await getDb();
  return db.collection<UserDoc>("users");
}

beforeEach(async () => {
  const users = await collection();
  await users.deleteMany({});
  // The unique index is what makes the recycled-username case meaningful, and
  // it only exists because the seed script creates it.
  await users.createIndexes([
    { key: { directoryId: 1 }, unique: true },
    { key: { username: 1 } },
  ]);
});

describe("upsertUserFromDirectory", () => {
  it("creates the user on first login", async () => {
    const user = await upsertUserFromDirectory(DANA);

    expect(user).toEqual({
      id: expect.stringMatching(/^[0-9a-f]{24}$/),
      name: "דנה כהן",
      username: "dana",
    });

    const doc = await (await collection()).findOne({
      directoryId: DANA.directoryId,
    });
    expect(doc).toMatchObject({
      username: "dana",
      upn: "dana@test.local",
      mail: "dana@test.local",
      dn: DANA.dn,
    });
  });

  it("does not insert a second document on the next login", async () => {
    await upsertUserFromDirectory(DANA);
    await upsertUserFromDirectory(DANA);

    expect(await (await collection()).countDocuments()).toBe(1);
  });

  it("keeps the same id across a rename", async () => {
    // The entire argument for keying on objectGUID: a marriage, a department
    // transfer or a display-name fix must not orphan everything the user added.
    const first = await upsertUserFromDirectory(DANA);

    const renamed = await upsertUserFromDirectory({
      ...DANA,
      username: "dana.levi",
      upn: "dana.levi@test.local",
      displayName: "דנה לוי",
      dn: "CN=Dana Levi,OU=Users,DC=test,DC=local",
    });

    expect(renamed.id).toBe(first.id);
    expect(renamed.name).toBe("דנה לוי");
    expect(renamed.username).toBe("dana.levi");
    expect(await (await collection()).countDocuments()).toBe(1);
  });

  it("gives a recycled username its own document", async () => {
    // AD reissues sAMAccountNames. A unique index on `username` would reject
    // the new employee's first login instead; this is why it isn't unique.
    const departed = await upsertUserFromDirectory(DANA);
    const newHire = await upsertUserFromDirectory({
      ...DANA,
      directoryId: "ffffffff-0000-1111-2222-333344445555",
      displayName: "דנה אחרת",
    });

    expect(newHire.id).not.toBe(departed.id);
    expect(await (await collection()).countDocuments()).toBe(2);
  });

  it("preserves createdAt but advances lastLoginAt", async () => {
    const first = new Date("2026-08-01T09:00:00.000Z");
    const second = new Date("2026-08-09T09:00:00.000Z");

    await upsertUserFromDirectory(DANA, first);
    await upsertUserFromDirectory(DANA, second);

    const doc = await (await collection()).findOne({
      directoryId: DANA.directoryId,
    });
    expect(doc?.createdAt).toEqual(first);
    expect(doc?.lastLoginAt).toEqual(second);
  });

  it("stores nothing password-derived", async () => {
    await upsertUserFromDirectory(DANA);

    const doc = await (await collection()).findOne({
      directoryId: DANA.directoryId,
    });
    expect(Object.keys(doc!).sort()).toEqual([
      "_id",
      "createdAt",
      "directoryId",
      "displayName",
      "dn",
      "lastLoginAt",
      "mail",
      "updatedAt",
      "upn",
      "username",
    ]);
  });
});

describe("getUser", () => {
  it("resolves a stored user by id", async () => {
    const created = await upsertUserFromDirectory(DANA);
    await expect(getUser(created.id)).resolves.toEqual(created);
  });

  it("returns null for an unknown id", async () => {
    await expect(getUser("6b0000000000000000000001")).resolves.toBeNull();
  });

  it("returns null for a malformed id rather than throwing", async () => {
    await expect(getUser("not-an-object-id")).resolves.toBeNull();
  });
});
