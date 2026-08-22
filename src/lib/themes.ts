import "server-only";

import { ObjectId, type Collection } from "mongodb";

import { getDb } from "@/lib/mongodb";
import { getRotation } from "@/lib/rotation";
import { type UserDoc } from "@/lib/users";
import {
  THEME_PAGE_SIZE,
  type Standing,
  type Theme,
  type ThemeMember,
  type ThemePage,
  type ThemeValues,
} from "@/lib/theme-schema";

export * from "@/lib/theme-schema";

/** Whoever is typing the record in, from the session — never from the body. */
export interface ThemeActor {
  /** `users._id` as a hex string. */
  id: string;
  /** AD display name, snapshotted onto `addedBy`. */
  name: string;
}

/** Shape stored in MongoDB. */
export interface ThemeDoc {
  _id: ObjectId;
  /** The meetup this was the theme of. UTC midnight. Unique — one per meetup. */
  date: Date;
  broughtById: ObjectId;
  /** Display-name snapshot, like `addedBy` on a quote. */
  broughtBy: string;
  theme: string;
  snacks: string[];
  /** Null while unsolved. */
  guessedById: ObjectId | null;
  guessedBy: string | null;
  /** Who typed the record in — NOT who brought or guessed it. */
  addedBy: string | null;
  addedById: ObjectId | null;
  updatedBy: string | null;
  updatedById: ObjectId | null;
  createdAt: Date;
  updatedAt: Date;
}

function serialize(doc: ThemeDoc): Theme {
  return {
    id: doc._id.toHexString(),
    date: doc.date.toISOString(),
    broughtById: doc.broughtById.toHexString(),
    broughtBy: doc.broughtBy,
    theme: doc.theme,
    snacks: doc.snacks,
    guessedById: doc.guessedById?.toHexString() ?? null,
    guessedBy: doc.guessedBy ?? null,
    addedBy: doc.addedBy ?? null,
    addedById: doc.addedById?.toHexString() ?? null,
    updatedBy: doc.updatedBy ?? null,
    updatedById: doc.updatedById?.toHexString() ?? null,
    createdAt: doc.createdAt.toISOString(),
    updatedAt: doc.updatedAt.toISOString(),
  };
}

async function themes(): Promise<Collection<ThemeDoc>> {
  const db = await getDb();
  return db.collection<ThemeDoc>("themes");
}

async function usersCollection(): Promise<Collection<UserDoc>> {
  const db = await getDb();
  return db.collection<UserDoc>("users");
}

/**
 * Every spec ends in `_id`: without a total order, offset pagination shows a
 * theme twice or skips it when two meetups tie on `date`.
 */
const SORT: Record<string, 1 | -1> = { date: -1, _id: -1 };

export async function listThemes({
  skip = 0,
  limit = THEME_PAGE_SIZE,
}: { skip?: number; limit?: number } = {}): Promise<ThemePage> {
  const collection = await themes();

  const safeSkip = Math.max(0, Math.floor(skip) || 0);
  const safeLimit = Math.min(
    Math.max(1, Math.floor(limit) || THEME_PAGE_SIZE),
    100,
  );

  const [docs, total] = await Promise.all([
    collection.find({}).sort(SORT).skip(safeSkip).limit(safeLimit).toArray(),
    collection.countDocuments(),
  ]);

  return {
    themes: docs.map(serialize),
    total,
    hasMore: safeSkip + docs.length < total,
  };
}

export async function getTheme(id: string): Promise<Theme | null> {
  if (!ObjectId.isValid(id)) return null;
  const collection = await themes();
  const doc = await collection.findOne({ _id: new ObjectId(id) });
  return doc ? serialize(doc) : null;
}

/** The names snapshotted onto a theme, resolved from the roster's `users` rows. */
export interface ResolvedMembers {
  broughtBy: string;
  guessedBy: string | null;
}

/**
 * Turn the two id fields into display-name snapshots, in a *single* `users`
 * lookup. A hex id that resolves to no user is invalid input, not a server
 * fault — so this returns per-field issues the route surfaces as a 422, rather
 * than letting the write proceed and 500.
 */
export async function resolveThemeMembers(
  input: Pick<ThemeValues, "broughtById" | "guessedById">,
): Promise<
  | { ok: true; members: ResolvedMembers }
  | { ok: false; issues: Record<string, string> }
> {
  const wanted = [input.broughtById];
  if (input.guessedById) wanted.push(input.guessedById);

  const collection = await usersCollection();
  const rows = await collection
    .find({ _id: { $in: wanted.map((id) => new ObjectId(id)) } })
    .toArray();
  const nameById = new Map(
    rows.map((row) => [row._id.toHexString(), row.displayName]),
  );

  const issues: Record<string, string> = {};

  const broughtBy = nameById.get(input.broughtById);
  if (!broughtBy) issues.broughtById = "מי שהביא לא נמצא ברשימה";

  let guessedBy: string | null = null;
  if (input.guessedById) {
    guessedBy = nameById.get(input.guessedById) ?? null;
    if (!guessedBy) issues.guessedById = "מי שניחש לא נמצא ברשימה";
  }

  if (Object.keys(issues).length > 0) return { ok: false, issues };
  return { ok: true, members: { broughtBy: broughtBy!, guessedBy } };
}

export async function createTheme(
  input: ThemeValues,
  members: ResolvedMembers,
  actor: ThemeActor,
): Promise<Theme> {
  const collection = await themes();
  const now = new Date();
  const doc: Omit<ThemeDoc, "_id"> = {
    // Parsed to UTC midnight, the way every other date here is stored.
    date: new Date(input.date),
    broughtById: new ObjectId(input.broughtById),
    broughtBy: members.broughtBy,
    theme: input.theme,
    snacks: input.snacks,
    guessedById: input.guessedById ? new ObjectId(input.guessedById) : null,
    guessedBy: members.guessedBy,
    addedBy: actor.name,
    addedById: new ObjectId(actor.id),
    updatedBy: null,
    updatedById: null,
    createdAt: now,
    updatedAt: now,
  };

  // A duplicate `date` throws 11000 against the unique index; the route turns
  // that into a 409. Deliberately no pre-check `findOne`, which races.
  const result = await collection.insertOne(doc as ThemeDoc);
  return serialize({ ...doc, _id: result.insertedId });
}

/**
 * Note what is *not* in the `$set`: `addedBy`/`addedById` are never rewritten,
 * exactly like `updateQuote`. Whoever edits a theme is recorded in `updatedBy`;
 * stamping them into `addedBy` would silently transfer the "logged it" credit,
 * and re-deriving `broughtBy` from the editor would rewrite who brought the
 * snacks. `broughtBy`/`guessedBy` follow their ids, so a correction to who
 * brought or guessed it updates the snapshot — but never to the editor.
 */
export async function updateTheme(
  id: string,
  input: ThemeValues,
  members: ResolvedMembers,
  actor: ThemeActor,
): Promise<Theme | null> {
  if (!ObjectId.isValid(id)) return null;
  const collection = await themes();

  const doc = await collection.findOneAndUpdate(
    { _id: new ObjectId(id) },
    {
      $set: {
        date: new Date(input.date),
        broughtById: new ObjectId(input.broughtById),
        broughtBy: members.broughtBy,
        theme: input.theme,
        snacks: input.snacks,
        guessedById: input.guessedById ? new ObjectId(input.guessedById) : null,
        guessedBy: members.guessedBy,
        updatedBy: actor.name,
        updatedById: new ObjectId(actor.id),
        updatedAt: new Date(),
      },
    },
    { returnDocument: "after" },
  );

  return doc ? serialize(doc) : null;
}

export async function deleteTheme(id: string): Promise<boolean> {
  if (!ObjectId.isValid(id)) return false;
  const collection = await themes();
  const result = await collection.deleteOne({ _id: new ObjectId(id) });
  return result.deletedCount === 1;
}

/**
 * The people a theme can name, for the picker and the default selection.
 *
 * Now the rotation *is* the roster: this reads the single `rotation` document
 * (resolved to `users` rows), so who the picker offers and who leaves the
 * standings both follow membership edits with no second list to keep in step.
 * Past guessers who have since left still appear in `getStandings` through their
 * snapshot, so nothing historical is lost. Empty on an unseeded database, which
 * the seed and the editor both fill.
 */
export async function getThemeRoster(): Promise<ThemeMember[]> {
  const roster = await getRotation();
  return roster.map((member) => ({
    id: member.id,
    name: member.name,
    role: member.role,
    gender: member.gender,
  }));
}

interface GuessGroup {
  _id: ObjectId;
  guesses: number;
  lastGuess: Date;
  name: string | null;
}

/**
 * The leaderboard, aggregated across **every** theme rather than a loaded page —
 * ranking the page the client happens to hold would be silently wrong once the
 * list paginates. Everyone on the roster appears, including those on zero (the
 * table dims them), and a guesser who has since left the roster is still
 * counted so history stays honest.
 */
export async function getStandings(): Promise<Standing[]> {
  const collection = await themes();
  const [roster, groups] = await Promise.all([
    getThemeRoster(),
    collection
      .aggregate<GuessGroup>([
        { $match: { guessedById: { $ne: null } } },
        {
          $group: {
            _id: "$guessedById",
            guesses: { $sum: 1 },
            lastGuess: { $max: "$date" },
            // The snapshot, so an off-roster guesser still has a name to show
            // without a $lookup.
            name: { $first: "$guessedBy" },
          },
        },
      ])
      .toArray(),
  ]);

  const byId = new Map(groups.map((g) => [g._id.toHexString(), g]));

  const standings: Standing[] = roster.map((member) => {
    const group = byId.get(member.id);
    return {
      id: member.id,
      name: member.name,
      role: member.role,
      guesses: group?.guesses ?? 0,
      lastGuess: group?.lastGuess.toISOString() ?? null,
    };
  });

  // Anyone with guesses who is no longer on the roster.
  const rosterIds = new Set(roster.map((member) => member.id));
  for (const group of groups) {
    const hex = group._id.toHexString();
    if (rosterIds.has(hex)) continue;
    standings.push({
      id: hex,
      name: group.name ?? "לא ידוע",
      role: null,
      guesses: group.guesses,
      lastGuess: group.lastGuess.toISOString(),
    });
  }

  return standings.sort(
    (a, b) =>
      b.guesses - a.guesses ||
      (b.lastGuess ?? "").localeCompare(a.lastGuess ?? ""),
  );
}

export async function getThemeStats(): Promise<{
  total: number;
  solved: number;
}> {
  const collection = await themes();
  const [total, solved] = await Promise.all([
    collection.countDocuments(),
    collection.countDocuments({ guessedById: { $ne: null } }),
  ]);
  return { total, solved };
}
