import "server-only";

import { ObjectId, type Collection } from "mongodb";

import { getDb } from "@/lib/mongodb";
import { getShotefRotation } from "@/lib/shotef";
import {
  type AwardIcon,
  type MonitorInput,
  type SolvedMonitor,
  type Solver,
} from "@/lib/shotef-schema";
import { type UserDoc } from "@/lib/users";

export * from "@/lib/shotef-schema";

/**
 * היכל התהילה — the wall of monitors somebody finally silenced.
 *
 * The `server-only` half of the hall of fame, the same split quotes and themes
 * keep: `shotef-schema.ts` holds the types, the Zod schema and the pure helpers
 * and is safe in the browser; this module owns the collection and re-exports the
 * schema so server code needs one import.
 */

/** Whoever typed the certificate in, from the session — never from the body. */
export interface MonitorActor {
  /** `users._id` as a hex string. */
  id: string;
  /** AD display name, snapshotted onto `addedBy`. */
  name: string;
}

/**
 * Shape stored in MongoDB.
 *
 * No `updatedBy`/`updatedAt` pair, unlike a quote or a theme: a certificate can
 * only be added. Carrying an edit trail for a write path that does not exist is
 * a field that is always null and a reader who has to work out why.
 */
export interface MonitorDoc {
  _id: ObjectId;
  icon: AwardIcon;
  /** The alert string verbatim — the certificate's own title. */
  monitor: string;
  solution: string;
  /**
   * `users._id`, the same rows the rotation and the themes point at — never the
   * hand-written slugs the fixtures used. Stored deduped: the schema folds the
   * array through a `Set` before it gets here, so a name written twice on one
   * certificate is one name, and the board can count array entries as plaques.
   */
  solvedByIds: ObjectId[];
  /** UTC midnight, like every other date here. */
  firstFiredAt: Date;
  solvedAt: Date;
  minutesToFix: number;
  /** Who typed the record in — NOT who solved it. Null for seeded content. */
  addedBy: string | null;
  addedById: ObjectId | null;
  createdAt: Date;
}

/**
 * `addedBy`/`addedById` are deliberately not serialized: `SolvedMonitor` has no
 * field for them, and the wall credits the solvers rather than the clerk. They
 * are stored anyway, the way a quote records who logged it — the day the wall
 * wants a "הוסיף/ה" line the data is already there rather than starting empty.
 */
function serialize(doc: MonitorDoc): SolvedMonitor {
  return {
    id: doc._id.toHexString(),
    icon: doc.icon,
    monitor: doc.monitor,
    solution: doc.solution,
    solvedByIds: doc.solvedByIds.map((id) => id.toHexString()),
    firstFiredAt: doc.firstFiredAt.toISOString(),
    solvedAt: doc.solvedAt.toISOString(),
    minutesToFix: doc.minutesToFix,
  };
}

async function monitors(): Promise<Collection<MonitorDoc>> {
  const db = await getDb();
  return db.collection<MonitorDoc>("shotef_monitors");
}

async function usersCollection(): Promise<Collection<UserDoc>> {
  const db = await getDb();
  return db.collection<UserDoc>("users");
}

/**
 * Newest save first, the order the wall reads in. Ends in `_id` like every other
 * sort spec here: two monitors closed on the same day tie on `solvedAt`, and
 * without a total order they can swap places between two reads.
 */
const SORT: Record<string, 1 | -1> = { solvedAt: -1, _id: -1 };

/**
 * The whole wall. Unpaginated on purpose — the section has no affordance for
 * paging and the aggregates below are collection-wide either way, so there is no
 * page for them to disagree with.
 */
export async function listMonitors(): Promise<SolvedMonitor[]> {
  const collection = await monitors();
  const docs = await collection.find({}).sort(SORT).toArray();
  return docs.map(serialize);
}

/**
 * Check that every name on the certificate is somebody this app knows.
 *
 * A hex id that resolves to no user is invalid input, not a server fault — so
 * this reports an issue the route surfaces as a 422 rather than writing a
 * dangling reference and leaving the wall to render a plaque with nobody on it.
 *
 * Membership of the on-call rotation is deliberately *not* required: most pages
 * are not silenced alone, and whoever knew the subsystem is often not the shotef
 * — the certificate can credit anyone in `users`. The podium is the part that
 * only ranks the roster, which is `solverBoard`'s documented behaviour.
 */
export async function resolveSolvers(
  solvedByIds: string[],
): Promise<{ ok: true } | { ok: false; issues: Record<string, string> }> {
  const unknown = { ok: false as const, issues: { solvedByIds: "אחד מהשמות לא נמצא ברשימה" } };

  // Guarded before constructing: `new ObjectId` throws on a malformed string,
  // and a malformed id is the same kind of bad input as an unknown one.
  if (solvedByIds.some((id) => !ObjectId.isValid(id))) return unknown;

  const rows = await (await usersCollection())
    .find({ _id: { $in: solvedByIds.map((id) => new ObjectId(id)) } })
    .project({ _id: 1 })
    .toArray();

  // The schema has already deduped, so a short count means someone is missing.
  if (rows.length !== solvedByIds.length) return unknown;
  return { ok: true };
}

export async function createMonitor(
  input: MonitorInput,
  actor: MonitorActor,
): Promise<SolvedMonitor> {
  const collection = await monitors();
  const doc: Omit<MonitorDoc, "_id"> = {
    icon: input.icon,
    monitor: input.monitor,
    solution: input.solution,
    solvedByIds: input.solvedByIds.map((id) => new ObjectId(id)),
    // `new Date("2026-06-09")` is UTC midnight, which is what the formatters
    // render in — parsing in local time shifts the day west of Greenwich.
    firstFiredAt: new Date(input.firstFiredAt),
    solvedAt: new Date(input.solvedAt),
    minutesToFix: input.minutesToFix,
    addedBy: actor.name,
    addedById: new ObjectId(actor.id),
    createdAt: new Date(),
  };

  const result = await collection.insertOne(doc as MonitorDoc);
  return serialize({ ...doc, _id: result.insertedId });
}

interface SolverGroup {
  _id: ObjectId;
  solved: number;
  lastSolved: Date;
}

/**
 * The podium, counted across **every** certificate rather than a loaded list.
 *
 * This is the `getStandings` rule, for the same reason: an aggregate reduced
 * over whatever the client happens to hold is silently wrong the day the list
 * stops being the whole collection, and a hall of fame only ever grows. The
 * pure `solverBoard` in `shotef-schema.ts` stays — it is what the client folds
 * an optimistic new certificate into — and a test pins the two to the same
 * answer over the same data so they cannot drift.
 *
 * Anyone no longer on the rotation drops out rather than appearing nameless,
 * exactly as `solverBoard` documents: their plaques keep their names, which is
 * where the record actually lives. Note this differs from `getStandings`, which
 * can keep an ex-guesser through the display-name snapshot on the theme — a
 * certificate has no such snapshot to fall back on.
 */
export async function getSolverBoard(): Promise<Solver[]> {
  const collection = await monitors();

  const [roster, groups] = await Promise.all([
    getShotefRotation(),
    collection
      .aggregate<SolverGroup>([
        {
          // Through `$setUnion`, the database-side spelling of the `Set` in
          // `solversOf`: a name written twice on one certificate is still one
          // plaque, because it is the certificates being counted.
          $project: {
            solvers: { $setUnion: ["$solvedByIds", []] },
            solvedAt: 1,
          },
        },
        { $unwind: "$solvers" },
        {
          $group: {
            _id: "$solvers",
            solved: { $sum: 1 },
            lastSolved: { $max: "$solvedAt" },
          },
        },
      ])
      .toArray(),
  ]);

  const byId = new Map(groups.map((group) => [group._id.toHexString(), group]));

  return roster
    .flatMap((member) => {
      const group = byId.get(member.id);
      if (!group) return [];
      return [
        {
          // Rebuilt field by field rather than spread: `RosterMember` carries a
          // `directoryId`, and this board goes over the wire on a public GET.
          member: {
            id: member.id,
            name: member.name,
            role: member.role,
            gender: member.gender,
          },
          solved: group.solved,
          lastSolved: group.lastSolved.toISOString(),
        },
      ];
    })
    .sort(
      // The same comparator `solverBoard` uses: form breaks a tie, not name order.
      (a, b) => b.solved - a.solved || b.lastSolved.localeCompare(a.lastSolved),
    );
}

/**
 * The quickest save on the wall, across the whole collection for the same reason
 * the board is. The tie-break mirrors the pure `fastestFix` reading a
 * newest-first wall: on equal minutes the more recent save wins.
 */
export async function getFastestFix(): Promise<SolvedMonitor | undefined> {
  const collection = await monitors();
  const [doc] = await collection
    .find({})
    .sort({ minutesToFix: 1, solvedAt: -1, _id: -1 })
    .limit(1)
    .toArray();
  return doc ? serialize(doc) : undefined;
}
