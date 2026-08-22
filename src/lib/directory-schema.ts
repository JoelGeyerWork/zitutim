/**
 * A person as the directory *search* returns them — client-safe, and free of
 * any `ldapts` import so the rotation editor can hold the type.
 *
 * These are the only four fields ever handed to the browser: `dn` and `mail`
 * come back from the directory too, but neither has any business on the client,
 * so they are dropped before a `DirectoryPerson` is built. Mirrors the
 * schema/server split `quote-schema.ts` keeps against `quotes.ts`.
 */
export interface DirectoryPerson {
  /** objectGUID in canonical string form, or entryUUID — immutable, survives a rename. */
  directoryId: string;
  displayName: string;
  /** AD has no field the directory is *required* to fill, so this can be null. */
  title: string | null;
  /** First login attribute (sAMAccountName / uid), for telling two same-named people apart. */
  username: string;
}
