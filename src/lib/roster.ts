/**
 * The roster: who is in the refreshment rotation, in what order.
 *
 * This is the half the app owns. A member is a *directory* person — their name,
 * title and immutable id all come from there — plus the three things the
 * directory has no concept of: where they sit in the rotation, how Hebrew
 * should conjugate for them, and whether they are still in it.
 *
 * When this moves to Mongo it is not a new collection: it is a `roster`
 * sub-document on the existing `users` row, keyed on the same `directoryId`
 * that `upsertUserFromDirectory` already writes. Splitting it out would fork
 * the same person into two ids the moment a roster member signs in.
 *
 * Hard-coded and client-safe for now, like `team.ts`.
 */

import { personByUsername, type DirectoryPerson } from "@/lib/directory";
import { rotate, type Member } from "@/lib/team";

export type RosterMember = Member & {
  /** objectGUID. What the row is keyed on, and the only thing never edited. */
  directoryId: string;
  username: string;
  /** Out of the rotation but still on file — their name is on past themes. */
  active: boolean;
};

/** Rotation order is the order of this list. Gender is not in the directory. */
const SEED: { username: string; gender: Member["gender"]; active?: boolean }[] = [
  { username: "noa.bareket", gender: "f" },
  { username: "itay.sharon", gender: "m" },
  { username: "shira.levi", gender: "f" },
  { username: "daniel.amar", gender: "m" },
  { username: "tamar.rozen", gender: "f" },
  { username: "yonatan.katz", gender: "m" },
  { username: "maya.gilad", gender: "f" },
  { username: "ori.benhaim", gender: "m" },
  { username: "roi.ashkenazi", gender: "m" },
  { username: "yael.markovich", gender: "f", active: false },
  { username: "shahar.edri", gender: "m", active: false },
];

export const ROSTER: RosterMember[] = SEED.map(({ username, gender, active }) => {
  const person = personByUsername(username);
  if (!person) throw new Error(`אין ברשימה: ${username}`);
  return fromDirectory(person, gender, active ?? true);
});

/**
 * A directory hit becomes a roster member. Name and title are *snapshots* —
 * the same treatment `addedBy` gets on a quote — read from the directory rather
 * than typed by hand, so there is nothing here to drift.
 */
export function fromDirectory(
  person: DirectoryPerson,
  gender: Member["gender"],
  active = true,
): RosterMember {
  return {
    // Stands in for the `users._id` that quotes and themes already reference.
    id: person.username,
    name: person.displayName,
    role: person.title,
    gender,
    directoryId: person.directoryId,
    username: person.username,
    active,
  };
}

/** Pull `from` out of the list and drop it back in at `to`. */
export function moveItem<T>(list: T[], from: number, to: number): T[] {
  const next = [...list];
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item);
  return next;
}

/**
 * Store the rotation back from the order the screen shows it in.
 *
 * The list is drawn from whoever is up this week — `rotate(active, offset)` —
 * so the stored order is that same cycle turned back by `offset`. Rebuilding it
 * whole, rather than translating each move, is what keeps a drop anywhere in
 * the list honest across the wrap.
 */
export function reorder(
  roster: RosterMember[],
  queue: RosterMember[],
  offset: number,
): RosterMember[] {
  const size = queue.length;
  const active = size > 0 ? rotate(queue, (size - (offset % size)) % size) : [];

  return [...active, ...roster.filter((member) => !member.active)];
}
