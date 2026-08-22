import "server-only";

import { cache } from "react";
import { ObjectId, type Collection } from "mongodb";
import { z } from "zod";

import { getDb } from "@/lib/mongodb";
import { type RosterMember } from "@/lib/roster";
import { type UserDoc } from "@/lib/users";

export * from "@/lib/roster";

/**
 * The refreshment rotation, as a *single* document.
 *
 * One collection, one row, always at `_id: "current"`. Rotation order is array
 * order and nothing else: identity — name, title, `directoryId`, and every theme
 * that FKs against it — lives on the `users` row `members[i].userId` names, so
 * there is nothing to reconcile between the two. Storing the order as one array
 * (rather than per-member `order` integers) makes a reorder one atomic `$set`
 * and keeps last-write-wins free: the last write of the array simply *is* the
 * state.
 */
export interface RotationDoc {
  _id: "current";
  members: { userId: ObjectId; gender: "m" | "f" }[];
  updatedAt: Date;
}

/** Every read and write targets this exact `_id`; there is no other row. */
const ROTATION_ID = "current" as const;

const genderSchema = z.enum(["m", "f"]);

/** POST body — a directory id (never a name) plus the one field AD can't answer. */
export const rotationAddSchema = z.object({
  directoryId: z.string().trim().min(1, "מזהה חסר"),
  gender: genderSchema,
});

/** PATCH body — just the grammatical gender. */
export const rotationGenderSchema = z.object({ gender: genderSchema });

/**
 * PUT /order body — the new stored order as `users._id` hex strings. The deeper
 * check (same set, no dupes, right length) is `reorderMembers`, since it needs
 * the current members to compare against.
 */
export const rotationOrderSchema = z.object({
  ids: z.array(z.string().regex(/^[a-f0-9]{24}$/i, "מזהה לא תקין")).min(1),
});

export type RotationGender = z.infer<typeof genderSchema>;

async function rotation(): Promise<Collection<RotationDoc>> {
  const db = await getDb();
  return db.collection<RotationDoc>("rotation");
}

async function usersCollection(): Promise<Collection<UserDoc>> {
  const db = await getDb();
  return db.collection<UserDoc>("users");
}

/**
 * The rotation in stored order, each member resolved to their `users` row.
 *
 * Tolerates the document's absence — a fresh database has never had a write, so
 * an empty rotation reads back as `[]` rather than an error. A member whose
 * `users` row somehow vanished is skipped rather than crashing the public read.
 *
 * Wrapped in React `cache()` so both call sites that need the rotation within
 * one request — the themes page's own `getThemeRoster` and the one inside
 * `getStandings` — share a single resolution instead of hitting Mongo twice.
 * Outside a render (the tests) `cache` is a no-op, so each call still reads
 * fresh.
 */
export const getRotation = cache(async (): Promise<RosterMember[]> => {
  const doc = await (await rotation()).findOne({ _id: ROTATION_ID });
  if (!doc || doc.members.length === 0) return [];

  const rows = await (await usersCollection())
    .find({ _id: { $in: doc.members.map((member) => member.userId) } })
    .toArray();
  const byId = new Map(rows.map((row) => [row._id.toHexString(), row]));

  const out: RosterMember[] = [];
  for (const member of doc.members) {
    const row = byId.get(member.userId.toHexString());
    if (!row) continue;
    out.push({
      id: row._id.toHexString(),
      name: row.displayName,
      role: row.title ?? "",
      gender: member.gender,
      directoryId: row.directoryId,
    });
  }
  return out;
});

export type AddOutcome = { ok: true } | { ok: false; reason: "already-in" };

/**
 * Append a member. The caller has already re-resolved the person through the
 * directory and upserted their `users` row, so this only records sequence and
 * gender. `already-in` is a race — the editor offers no button for someone the
 * rotation already holds.
 */
export async function addMember(
  userId: string,
  gender: RotationGender,
): Promise<AddOutcome> {
  if (!ObjectId.isValid(userId)) return { ok: false, reason: "already-in" };
  const id = new ObjectId(userId);
  const collection = await rotation();

  // Ensure the singleton exists first, so the append below never has to upsert.
  // A fresh database has no document; two concurrent first-adds can both try to
  // insert `_id: "current"` and one hits the unique `_id` index — which just
  // means the other created it, so a duplicate-key error *here* is success.
  try {
    await collection.updateOne(
      { _id: ROTATION_ID },
      { $setOnInsert: { members: [], updatedAt: new Date() } },
      { upsert: true },
    );
  } catch (error) {
    if (
      !error ||
      typeof error !== "object" ||
      (error as { code?: number }).code !== 11000
    ) {
      throw error;
    }
  }

  // The document exists now, so the append needs no upsert — which is what lets
  // the `$ne` guard do its job. This one atomic write replaces a `findOne`
  // presence check followed by a separate `$push`: the two-step version races a
  // double-click and pushes the same `userId` twice. Here the guard is folded
  // into the filter, so concurrent adds serialise and only one matches; a
  // second matches nothing and reports `already-in`.
  const result = await collection.updateOne(
    { _id: ROTATION_ID, "members.userId": { $ne: id } },
    {
      $push: { members: { userId: id, gender } },
      $set: { updatedAt: new Date() },
    },
  );
  if (result.matchedCount === 0) return { ok: false, reason: "already-in" };
  return { ok: true };
}

export type RemoveOutcome = "removed" | "not-found" | "last";

/**
 * Remove a member by splicing them out. Removing is *forgetting*: nothing about
 * a former member is kept here — their `users` row and their theme history are
 * untouched. Refuses to empty the rotation, which would leave nobody to bring
 * the refreshments and no slot to render.
 */
export async function removeMember(userId: string): Promise<RemoveOutcome> {
  if (!ObjectId.isValid(userId)) return "not-found";
  const id = new ObjectId(userId);
  const collection = await rotation();

  // Pull the member only if they are present *and* more than one remains, both
  // folded into the filter so the guard and the write are one atomic step. A
  // `length === 1` read followed by a separate `$pull` races: two concurrent
  // deletes on a two-person rotation each read length 2 and both pull, leaving
  // nobody to bring the refreshments. Here the second delete matches nothing
  // once the first has dropped the count to 1.
  const result = await collection.updateOne(
    {
      _id: ROTATION_ID,
      "members.userId": id,
      $expr: { $gt: [{ $size: "$members" }, 1] },
    },
    { $pull: { members: { userId: id } }, $set: { updatedAt: new Date() } },
  );
  if (result.matchedCount === 1) return "removed";

  // Nothing changed: either the member is not here (not-found) or they are the
  // only one left (last). A single read tells the two apart — and because the
  // pull is refused for the last member, this read can never contradict a write
  // that already happened.
  const doc = await collection.findOne({ _id: ROTATION_ID });
  const present = doc?.members.some((member) => member.userId.equals(id));
  if (present && doc!.members.length === 1) return "last";
  return "not-found";
}

/** Set one member's grammatical gender. `false` when they are not in the rotation. */
export async function setGender(
  userId: string,
  gender: RotationGender,
): Promise<boolean> {
  if (!ObjectId.isValid(userId)) return false;
  const id = new ObjectId(userId);

  const result = await (await rotation()).updateOne(
    { _id: ROTATION_ID, "members.userId": id },
    { $set: { "members.$.gender": gender, updatedAt: new Date() } },
  );
  return result.matchedCount === 1;
}

export type ReorderOutcome = { ok: true } | { ok: false };

/**
 * Replace the stored order with the one handed in — **last-write-wins**, no
 * stale-set check. The only rejections are malformed input: an id not currently
 * in `members`, a duplicate, or the wrong count. That is validation, not
 * concurrency control; two editors racing is rare here and the later save simply
 * winning is acceptable. Writes nothing when the set is invalid.
 */
export async function reorderMembers(ids: string[]): Promise<ReorderOutcome> {
  const collection = await rotation();
  const doc = await collection.findOne({ _id: ROTATION_ID });
  const members = doc?.members ?? [];

  if (ids.length !== members.length) return { ok: false };
  if (new Set(ids).size !== ids.length) return { ok: false };

  const byId = new Map(members.map((member) => [member.userId.toHexString(), member]));
  const reordered: RotationDoc["members"] = [];
  for (const hex of ids) {
    const member = byId.get(hex);
    if (!member) return { ok: false };
    reordered.push(member);
  }

  await collection.updateOne(
    { _id: ROTATION_ID },
    { $set: { members: reordered, updatedAt: new Date() } },
    { upsert: true },
  );
  return { ok: true };
}
