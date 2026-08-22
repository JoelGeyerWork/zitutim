/**
 * The rotation as the browser sees it, plus the two pure order helpers the
 * editor's drag depends on.
 *
 * Membership itself now lives in the `rotation` collection (see `rotation.ts`)
 * and reaches the client as `initialRoster`, resolved from `users` rows, off the
 * server page. There is no hard-coded roster here any more and no notion of an
 * *inactive* member: removing someone splices them out, and their identity
 * survives only on their `users` row and the themes that reference it.
 *
 * Client-safe on purpose — no `server-only`, no database — like `team.ts`.
 */

import { rotate } from "@/lib/team";

export type RosterMember = {
  /** `users._id` as a hex string — the FK a theme points at, and the mutate key. */
  id: string;
  name: string;
  role: string;
  /** Hebrew conjugates the verb ("מביא"/"מביאה"); the directory has no such field. */
  gender: "m" | "f";
  /** objectGUID, so a directory search can tell who is already in the rotation. */
  directoryId: string;
};

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
 * The list is drawn from whoever is up this week — `rotate(members, offset)` —
 * so the stored order is that same cycle turned back by `offset`. Turning the
 * displayed cycle back whole, rather than translating each individual move, is
 * what keeps a drop anywhere in the list honest across the wrap.
 */
export function reorder(queue: RosterMember[], offset: number): RosterMember[] {
  const size = queue.length;
  return size > 0 ? rotate(queue, (size - (offset % size)) % size) : [];
}
