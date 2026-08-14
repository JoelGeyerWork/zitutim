import "server-only";

import { ObjectId, type Collection } from "mongodb";

import { getDb } from "@/lib/mongodb";
import { type DirectoryUser } from "@/lib/ldap";
import { type SessionUser } from "@/lib/auth-schema";

export * from "@/lib/auth-schema";

/**
 * Shape stored in MongoDB.
 *
 * Keyed on objectGUID rather than sAMAccountName because AD *recycles*
 * usernames: without it, a new employee inheriting a departed colleague's
 * username would inherit their quotes, comments and likes too. objectGUID is
 * immutable for the object's lifetime and survives both rename and OU moves.
 *
 * Nothing here is password-derived, and group memberships are deliberately not
 * stored — the app has no use for them and they age badly.
 */
export interface UserDoc {
  /** App-internal id. This — not directoryId — is what quotes reference. */
  _id: ObjectId;
  /** objectGUID in canonical string form. Unique. */
  directoryId: string;
  /** sAMAccountName, lowercased. NOT unique: AD recycles these. */
  username: string;
  upn: string | null;
  /** The source of the `addedBy` snapshot written onto a quote. */
  displayName: string;
  mail: string | null;
  /** Last-seen distinguishedName. Changes when the object moves OU. */
  dn: string;
  createdAt: Date;
  updatedAt: Date;
  lastLoginAt: Date;
}

async function users(): Promise<Collection<UserDoc>> {
  const db = await getDb();
  return db.collection<UserDoc>("users");
}

function toSessionUser(doc: UserDoc): SessionUser {
  return {
    id: doc._id.toHexString(),
    name: doc.displayName,
    username: doc.username,
  };
}

/**
 * Record a successful directory login, creating the user on first sight.
 *
 * The directory is the authority for every field except `_id`, so all of them
 * are refreshed on every login — a rename in AD shows up here immediately while
 * the user's id, and therefore everything attributed to them, stays put.
 */
export async function upsertUserFromDirectory(
  profile: DirectoryUser,
  now: Date = new Date(),
): Promise<SessionUser> {
  const collection = await users();

  const update = {
    $set: {
      username: profile.username,
      upn: profile.upn,
      displayName: profile.displayName,
      mail: profile.mail,
      dn: profile.dn,
      updatedAt: now,
      lastLoginAt: now,
    },
    $setOnInsert: { directoryId: profile.directoryId, createdAt: now },
  };

  try {
    const doc = await collection.findOneAndUpdate(
      { directoryId: profile.directoryId },
      update,
      { upsert: true, returnDocument: "after" },
    );
    return toSessionUser(doc!);
  } catch (error) {
    // Two concurrent first-logins for the same new account can still collide on
    // the unique index despite `upsert: true` — Mongo's upsert is not atomic
    // against a racing insert. By the time we retry, the winner's document
    // exists and this becomes a plain update.
    if (
      error &&
      typeof error === "object" &&
      (error as { code?: number }).code === 11000
    ) {
      const doc = await collection.findOneAndUpdate(
        { directoryId: profile.directoryId },
        update,
        { upsert: true, returnDocument: "after" },
      );
      return toSessionUser(doc!);
    }
    throw error;
  }
}

export async function getUser(id: string): Promise<SessionUser | null> {
  if (!ObjectId.isValid(id)) return null;
  const collection = await users();
  const doc = await collection.findOne({ _id: new ObjectId(id) });
  return doc ? toSessionUser(doc) : null;
}
