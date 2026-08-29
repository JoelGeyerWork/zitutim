/**
 * How a form names a person it wants stored against a record.
 *
 * Two sources, and the tag says which — never sniffed from the shape of the id.
 * `user` is a `users._id` this app already holds; `directory` is an objectGUID
 * the browser only ever got from `GET /api/directory`, for somebody who may
 * have no `users` row yet. The server resolves both to a `users._id` before
 * anything is written (`resolvePeople` in `people.ts`), so a stored record only
 * ever references a row that exists.
 *
 * A tagged reference rather than two parallel fields (`memberId` plus
 * `memberDirectoryId`, `solvedByIds` plus `solvedByDirectoryIds`) for one
 * reason that only shows on the certificate: the names on it are an *ordered*
 * list, and two arrays have no single order to merge back into. One field keeps
 * one answer to "who is named", in the order they were named.
 *
 * The `user` arm is what keeps this available: a form that picked a name out of
 * the rotation sends `{ source: "user" }`, and the write path never opens an
 * LDAP connection. The directory is the *addition*, so an unreachable domain
 * controller costs the search box and nothing else.
 *
 * Client-safe on purpose — no `server-only`, no `mongodb`, no `ldapts`.
 * `src/lib/people.ts` is the server half and re-exports this.
 */

import { z } from "zod";

export type PersonSource = "user" | "directory";

export type PersonRef = {
  source: PersonSource;
  /** A `users._id` hex string, or an objectGUID — whichever `source` says. */
  id: string;
};

export const personRefSchema = z.discriminatedUnion(
  "source",
  [
    z.object({ source: z.literal("user"), id: z.string().trim().min(1) }),
    z.object({ source: z.literal("directory"), id: z.string().trim().min(1) }),
  ],
  { error: "צריך לבחור אדם" },
);

/**
 * One string per reference, for deduping and for keying a list in React.
 *
 * Deliberately *not* an identity test: the same person reached as a `user` row
 * and as a directory result are two different keys, and only the server can
 * tell that they are one person. It folds them together after resolving —
 * see `resolvePeople`.
 */
export function personKey(ref: PersonRef): string {
  return `${ref.source}:${ref.id}`;
}

/** The reference for somebody the app already has a row for. */
export function userRef(id: string): PersonRef {
  return { source: "user", id };
}

/** The reference for somebody picked out of the organisation's directory. */
export function directoryRef(directoryId: string): PersonRef {
  return { source: "directory", id: directoryId };
}

/**
 * Fold a list of references down to one entry per reference, first occurrence
 * winning. Used by both input schemas: the forms cannot send a name twice, but
 * a schema is what a route handler trusts, and that one can be sent anything.
 */
export function dedupeRefs(refs: PersonRef[]): PersonRef[] {
  const seen = new Set<string>();
  return refs.filter((ref) => {
    const key = personKey(ref);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
