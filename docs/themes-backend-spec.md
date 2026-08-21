# Spec — persist the theme-guessing game

Implement the backend for `/meetups/themes`, which today runs on the hard-coded
`THEMES` array in `src/lib/themes.ts`. The UI is built and signed off: **it is
the contract**. Change it only where this spec says to.

**Read `CLAUDE.md` and `AGENTS.md` first.** The Next.js version here is not the
one in your training data, and the server/client module split, the auth error
contract and the UTC date invariant are all deliberate.

## 1. Scope

**In:** a `themes` collection, its REST API, server-computed standings, indexes,
seeds, tests.

**Out:** the rotation. `/meetups` keeps its hard-coded roster and its local
editing for now — that is a separate spec. Also out: roles beyond the existing
"any signed-in user may write", and notifications.

### The one dependency a foreign key forces

A theme records who brought it and who guessed it, as real references into
`users` — `broughtById`/`guessedById` are `ObjectId`s, validated to resolve to a
real user (§4), the same way a quote's `addedById` is real.

A foreign key needs its target to exist, and the referenced people are today the
hard-coded roster, which has no `users` rows. So this spec owns the **minimum**
that makes the reference real, and no more:

- **The seed creates a `users` row per roster member** (§8), keyed on
  `directoryId` like every other user, so a demo theme points at a document that
  is actually there.
- **The server page reads those rows and hands them to the picker and the
  standings** as the member list, so the id the form posts is a real `users._id`
  hex, not the string `"ori"` the UI uses today.

What stays out: the rotation, its order, and editing membership — all still
hard-coded, all a separate spec. This does not persist the roster; it seeds the
identities a theme must be able to name, which is a strict subset. Flag it
(§11) if that subset starts growing.

Still do not resolve names through `$lookup` on the read path — the snapshot is
what renders (§3). The FK is for integrity and for standings, not for display.

## 2. Read before writing code

| File | Why |
|---|---|
| `src/lib/quotes.ts` + `src/lib/quote-schema.ts` | the exact pattern to copy for a data layer / schema pair |
| `src/app/api/quotes/route.ts`, `src/app/api/quotes/[id]/route.ts` | the auth + error contract to copy verbatim |
| `src/components/quote-form.tsx`, `src/components/quote-feed.tsx` | how a form renders 422s, and how a list re-seeds |
| `tests/server/api-quotes.test.ts`, `tests/server/factories.ts` | how handlers are tested (plain `Request`, real signed cookie) |
| `scripts/seed.mjs` | where indexes are declared |

## 3. Module split (non-negotiable)

`mongodb` must never reach the browser bundle. Mirror the quotes split exactly:

| Module | Marker | Contains |
|---|---|---|
| `src/lib/theme-schema.ts` | none — **client-safe** | `Theme`, `ThemePage`, `Standing`, `themeInputSchema`, `placeOf` |
| `src/lib/themes.ts` | `server-only`, re-exports the schema | the Mongo data layer |

Client components import only `theme-schema`.

## 4. The collection

```ts
interface ThemeDoc {
  _id: ObjectId;
  /** The meetup this was the theme of. UTC midnight. Unique — see below. */
  date: Date;
  /** Who brought the refreshments. users._id. */
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
```

Three things to hold onto:

1. **`broughtBy`/`guessedBy` are denormalized snapshots**, for the same reasons
   `addedBy` is on a quote: they are rendered directly, and they are the
   historically accurate name if that person is later renamed or leaves.
2. **`addedBy` is a different axis from `broughtBy`.** Whoever types the record
   in is rarely who brought the snacks. Do not conflate them, and take `addedBy`
   from the session only — never from the body.
3. **`date` is uniquely indexed.** One meetup, one theme. A duplicate `POST`
   returns **409** with a Hebrew message; corrections go through `PUT`. Catch
   Mongo error code `11000` — do not pre-check with a `findOne`, which races.

### Validation (`themeInputSchema`, client-safe)

Reuse the `dateOnly` helper from `quote-schema.ts` verbatim — the `2026-02-31`
round-trip refinement and the "not in the future" bound both apply, since a
theme records a meetup that already happened.

- `theme` — trimmed, 1–120, Hebrew error messages
- `snacks` — array of trimmed non-empty strings, max 20, each max 60. The form
  takes a comma-separated string, so **the split happens client-side**. Drop
  empties, do not dedupe.
- `date` — `dateOnly`
- `broughtById` — 24-char hex, required
- `guessedById` — 24-char hex or null

Reject a `broughtById`/`guessedById` that is not a known user with **422** on
that field, not a 500. One lookup covers both ids; the id is invalid input, not
a server fault.

No `broughtBy`/`guessedBy`/`addedBy` keys. Display names are resolved
server-side from the roster; anything sent under those keys is stripped, exactly
as `quoteInputSchema` strips `addedBy`.

## 5. API

`src/app/api/themes/route.ts` and `[id]/route.ts`. Copy the quotes handlers'
structure exactly, **including the order of the guards**: `isSameOrigin` → 403;
then session → 401 *before the body is parsed*, so validation is not an oracle
for anonymous probes; then 422 with `issues` keyed by field; 404 for an unknown
or malformed id; 409 for a duplicate date; 500 with a Hebrew message and a
`console.error`.

- `GET` is **public**, both collection and item. `DELETE` returns 204.
- `export const dynamic = "force-dynamic"`.
- `GET /api/themes` takes `skip`/`limit`, clamped as `listQuotes` clamps them,
  and returns `{ themes, total, hasMore }`.
- **Every sort spec ends in `_id`** — `{ date: -1, _id: -1 }`. Without a total
  order, offset pagination shows a row twice or skips it when dates tie.

## 6. Standings belong in the data layer

`standings()` currently runs in the browser over the whole in-memory array. Once
the list is paginated that is **silently wrong** — the client would rank only
the page it happens to be holding. This is the one thing here that is a design
change rather than a port.

```ts
getStandings(): Promise<Standing[]>   // $group on guessedById, joined to users
getThemeStats(): Promise<{ total: number; solved: number }>
```

`getStandings` reads the roster from `users` itself — it is a server module, so
it needs no roster passed in. `$group` on `guessedById`, then reconcile against
the member rows so everyone appears.

- Aggregate across **all** themes, never the loaded page.
- Include every roster member, **including those on zero** — the table ranks
  everyone and dims the zeros.
- Include anyone with guesses who is no longer a member, so history stays
  honest even after the FK's target stops being on the roster.
- Sort by guesses desc, then most-recent guess desc.
- `placeOf` stays pure and client-side. Keep its shared-position behaviour —
  five people on one guess are all 2nd, the next is 7th — and keep it tested.

## 7. Frontend wiring

Keep the visual design.

- `ThemesView` loses `useState` as the source of truth. It takes `initial`,
  `standings` and `stats`, and reconciles a new `initial` prop **during render**
  via a `seed` comparison, exactly like `QuoteFeed` —
  `react-hooks/set-state-in-effect` is an **error** in this config, not a
  warning.
- `ThemeFormDialog` posts to the API, renders `422` `issues` inline, and handles
  `401` by pushing to `/login?next=…`. Copy `quote-form.tsx`.
- Mutations `fetch` the API then `router.refresh()`; the server component reads
  the data layer directly, with no HTTP hop.
- Gate the "נושא חדש" button on `useSession` for UX. The API's 401 is the
  enforcement.
- Delete the `THEMES` constant once nothing imports it.

## 8. Indexes and seeds

In `scripts/seed.mjs`:

```js
themes: { date: -1 } (unique), { guessedById: 1 }
```

Extend the `--demo` path to:

1. **Upsert a `users` row per roster member** from the hard-coded list, keyed on
   `directoryId`, so the themes below have something real to reference. Idempotent
   on re-run.
2. **Insert the ten sample themes** from `themes.ts`, mapping each member string
   (`"ori"`, `"maya"`, …) to the `_id` of the row just seeded for them.

No-op when `themes` is already non-empty, like the quotes seed. The seed must
not need a reachable directory.

## 9. Tests

`npm test` must stay Docker-free and keep passing. Do not add a vitest project —
`test` names its two projects explicitly on purpose.

**`tests/server/themes.test.ts`**
- create / read / update / delete round-trips
- `date` stored at UTC midnight: `2026-08-18` comes back `2026-08-18T00:00:00.000Z`
- duplicate date rejected by the unique index, not by a pre-check
- pagination stable across pages when dates tie (the `_id` tiebreak)
- `update` never rewrites `broughtBy`/`addedBy` — mirror the `updateQuote`
  authorship test
- an unknown `broughtById` or `guessedById` is rejected, not stored
- standings: ordering, zero-guess members present, shared places, recency
  tiebreak, a guesser no longer on the roster still counted

**`tests/server/api-themes.test.ts`** — handlers called directly with plain
`Request` objects and `authedRequest()` from `tests/server/factories.ts`:
- 401 on every mutation without a session, **asserted for a malformed body too**,
  proving the session check precedes the parse
- 403 on `Origin` mismatch
- 422 shape: `{ error, issues: { field: message } }`
- 409 on duplicate date
- 422 for a `broughtById` that resolves to no user
- 404 for a valid-but-absent theme id **and** a malformed one (must not 500)
- `GET` works with no session
- display names in the body are ignored in favour of the session and the roster

**`tests/ui/themes-view.test.tsx`** — standings come from props rather than
being derived, and the list re-seeds when `initial` changes. Use `respondWith()`
from `tests/ui/factories.ts` for fetch mocks: a bare
`mockResolvedValue(new Response(...))` breaks on the second call, because a body
can only be read once.

## 10. Invariants

Everything under "Invariants worth not breaking" in `CLAUDE.md` still applies.
The four this work touches:

- Dates stored at UTC midnight and formatted in UTC.
- Every sort spec ends in `_id`.
- Route handlers read the session off the `Request` via `getSessionFrom`, never
  `next/headers` — the server suite calls them with plain `Request` objects,
  where `await cookies()` throws.
- New user-facing strings, API error messages included, are in Hebrew.

Adding a route means `npx next typegen`, or `tsc` reports a phantom error in a
file you did not touch.

## 11. Definition of done

```bash
npm test            # green, no Docker
npx tsc --noEmit    # clean
npm run lint        # clean
npm run build       # succeeds with no MONGODB_URI set
```

Plus, by hand: adding a theme survives a reload, the leaderboard matches the
history below it, and a theme added by one person attributes the snacks to
another without confusing the two.

Stop and ask if either of these turns out true:

- The unique index on `date` is wrong for how the team works — two meetups in a
  week, or one theme spanning several. That is a product decision.
- Making the FK real starts pulling in more than the seed and the picker read —
  roster ordering, editing, or LDAP. That is the separate roster spec leaking
  in; surface it rather than absorbing it here.
