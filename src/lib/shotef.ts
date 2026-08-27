import "server-only";

import {
  addMember,
  getRotation,
  removeMember,
  reorderMembers,
  setGender,
  type AddOutcome,
  type RemoveOutcome,
  type ReorderOutcome,
  type RotationGender,
  type RotationKey,
} from "@/lib/rotation";
import { type RosterMember } from "@/lib/roster";

export * from "@/lib/shotef-schema";

/**
 * השוטף — the server side of the on-call section.
 *
 * The rotation is a second row in the existing `rotation` collection rather
 * than a collection of its own: the document shape is identical
 * (`{ userId, gender }[]`, order is array position) and the singleton and
 * atomicity reasoning in `rotation.ts` is subtle enough that a second copy of
 * it is a second copy to keep in agreement. Everything below is a thin binding
 * of that module to this rotation's key, so the two can never diverge in
 * behaviour — only in which row they touch.
 *
 * The weekly reviews and the hall of fame have their own collections and their
 * own modules — `shotef-reviews.ts` and `shotef-monitors.ts`. Neither goes
 * through here: they reference `users` directly, so a name on a past week or a
 * certificate does not depend on who is in this rotation today.
 */
export const SHOTEF_ROTATION: RotationKey = "shotef";

/** The on-call order, resolved to `users` rows. Public, like the wheel it feeds. */
export function getShotefRotation(): Promise<RosterMember[]> {
  return getRotation(SHOTEF_ROTATION);
}

export function addShotefMember(
  userId: string,
  gender: RotationGender,
): Promise<AddOutcome> {
  return addMember(userId, gender, SHOTEF_ROTATION);
}

export function removeShotefMember(userId: string): Promise<RemoveOutcome> {
  return removeMember(userId, SHOTEF_ROTATION);
}

export function setShotefGender(
  userId: string,
  gender: RotationGender,
): Promise<boolean> {
  return setGender(userId, gender, SHOTEF_ROTATION);
}

export function reorderShotefMembers(ids: string[]): Promise<ReorderOutcome> {
  return reorderMembers(ids, SHOTEF_ROTATION);
}
