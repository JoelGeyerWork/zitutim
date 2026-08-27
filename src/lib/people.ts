import "server-only";

import { ObjectId, type Collection } from "mongodb";

import { ConfigError } from "@/lib/config-error";
import { findPersonById } from "@/lib/ldap";
import { getDb } from "@/lib/mongodb";
import { dedupeRefs, type PersonRef } from "@/lib/person-ref";
import { upsertRosterUser, type UserDoc } from "@/lib/users";

export * from "@/lib/person-ref";

/**
 * Turning what a form said about a person into the `users` row a record may
 * reference.
 *
 * The `server-only` half of `person-ref.ts`, and the one place either side of
 * the שוטף section answers "who is this?". It exists because a record of
 * something that happened must be able to name whoever it happened to — a week
 * worked by someone who has since left the on-call rotation, a colleague from
 * another team who was on the call — while a stored review or certificate still
 * references nothing but a real `users._id`.
 *
 * This is `POST /api/rotation`'s move, generalised: a `directory` reference is
 * re-resolved server-side with `findPersonById` and written through
 * `upsertRosterUser`, so nothing a client typed lands in a stored name, and
 * somebody added twice lands on their existing row rather than forking a second
 * one.
 */

/** A person, resolved to the row a record will point at. */
export interface ResolvedPerson {
  /** `users._id` as a hex string. */
  id: string;
  name: string;
}

/**
 * Why a resolution failed, in the three flavours the routes have to keep apart
 * — they send whoever investigates to opposite places, the same split the login
 * route draws between a `ConfigError` and a directory outage.
 *
 * `unknown` is bad *input*: a reference that names nobody, which is a 422 on
 * the field. `unavailable` is the directory being unreachable (503) and
 * `misconfigured` is this server missing its `LDAP_*` block (500).
 */
export type PersonFailure = "unknown" | "unavailable" | "misconfigured";

export type PersonResolution =
  | { ok: true; people: ResolvedPerson[] }
  | { ok: false; reason: PersonFailure };

async function usersCollection(): Promise<Collection<UserDoc>> {
  const db = await getDb();
  return db.collection<UserDoc>("users");
}

/**
 * Resolve every reference to a `users` row, in the order they were given.
 *
 * Two properties are load-bearing:
 *
 * - **A list of nothing but `user` references never touches LDAP.** The
 *   directory branch is skipped entirely, so naming somebody this app already
 *   knows keeps working with no domain controller on the network — which is the
 *   normal state here during an outage, and the whole state of the development
 *   network. The directory is the addition, not the replacement.
 * - **The `user` references are checked first.** A request that is going to be
 *   rejected as invalid input is rejected before any directory row is written,
 *   so a typo in one field does not quietly create a `users` row for the person
 *   named in another.
 *
 * The result is deduped on the resolved id rather than on the reference:
 * `dedupeRefs` cannot tell that `{ user, X }` and `{ directory, G }` are the
 * same person, and only this function ever learns that G resolves to X.
 */
export async function resolvePeople(
  refs: PersonRef[],
): Promise<PersonResolution> {
  const wanted = dedupeRefs(refs);
  if (wanted.length === 0) return { ok: true, people: [] };

  const resolved = new Map<string, ResolvedPerson>();

  const userIds = wanted
    .filter((ref) => ref.source === "user")
    .map((ref) => ref.id);

  if (userIds.length > 0) {
    // `new ObjectId` throws on a malformed string, and a malformed id is the
    // same kind of bad input as an unknown one.
    if (userIds.some((id) => !ObjectId.isValid(id))) {
      return { ok: false, reason: "unknown" };
    }

    const rows = await (await usersCollection())
      .find({ _id: { $in: userIds.map((id) => new ObjectId(id)) } })
      .project<{ _id: ObjectId; displayName: string }>({ displayName: 1 })
      .toArray();

    // Deduped above, so a short count means somebody is genuinely missing.
    if (rows.length !== userIds.length) return { ok: false, reason: "unknown" };

    for (const row of rows) {
      const id = row._id.toHexString();
      resolved.set(`user:${id}`, { id, name: row.displayName });
    }
  }

  for (const ref of wanted) {
    if (ref.source !== "directory") continue;

    let person;
    try {
      person = await findPersonById(ref.id);
    } catch (error) {
      if (error instanceof ConfigError) {
        console.error("directory lookup misconfigured", error);
        return { ok: false, reason: "misconfigured" };
      }
      console.error("directory lookup failed", error);
      return { ok: false, reason: "unavailable" };
    }

    // An id that resolves to nobody is invalid input, not a server fault.
    if (!person) return { ok: false, reason: "unknown" };

    // Writes the row rather than only reading it: the record about to be stored
    // references `users._id`, so somebody the app has never seen has to acquire
    // one. Idempotent and keyed on `directoryId`, so a request that is refused
    // further on (a week already summarised, say) has at worst added a real
    // colleague to `users` — which their first sign-in would have done anyway.
    const id = await upsertRosterUser(person);
    resolved.set(`directory:${ref.id}`, { id, name: person.displayName });
  }

  // Back into the order they were named in, folding out anyone named twice
  // through two different references.
  const seen = new Set<string>();
  const people: ResolvedPerson[] = [];
  for (const ref of wanted) {
    const person = resolved.get(`${ref.source}:${ref.id}`)!;
    if (seen.has(person.id)) continue;
    seen.add(person.id);
    people.push(person);
  }

  return { ok: true, people };
}
