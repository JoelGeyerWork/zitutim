# Spec — persist the refreshment rotation

Persist what the rotation editor (`RotationEditor`, the pencil beside the wheel)
already does on hard-coded data: who is in the rotation, in what order, adding a
person from the directory, removing one, and each person's grammatical gender.
The UI is built and signed off: **it is the contract**. Change it only where this
spec says to — and it says to in exactly one place (§9, the "not in the
rotation" section).

**Read `CLAUDE.md` and `AGENTS.md` first.** The Next.js version is not the one in
your training data; the server/client split, the auth error contract, the UTC
date rule and the LDAP invariants are deliberate.

## 0. This builds on the themes spec

`docs/themes-backend-spec.md` lands first and establishes three things this spec
relies on: the client-safe `team-schema.ts` / server `team.ts` module split, a
`users` row per rotation member keyed on `directoryId`, and `themes.broughtById`
/ `guessedById` as real `ObjectId` FKs into `users`. If any of that is not in
place, stop and say so rather than rebuilding it here.

## 1. Scope

**In:** a single-document rotation collection; a real LDAP directory name-search
behind an authenticated endpoint; add / remove / reorder / set-gender endpoints;
the editor and wheel wired to them; the demo seed; tests.

**Out:** materialised schedules or a stored turn cursor (the rotation stays
anchored — §5); remembering people who left the rotation (§4); roles beyond the
existing "any signed-in user may write"; a scheduled directory sync.

## 2. Read before writing code

| File | Why |
|---|---|
| `src/lib/quotes.ts`, `src/app/api/quotes/route.ts` + `[id]/route.ts` | the data-layer and auth+error contract to copy verbatim |
| `src/lib/ldap.ts` | `findUser`, `DirectoryUser`, `escapeFilterValue`, `guidToString`, the service-account bind, the config readers and the `misconfigured` vs `unavailable` split |
| `src/lib/users.ts` | how a directory identity becomes a `users` row keyed on `directoryId` |
| `src/lib/team.ts`, `src/lib/roster.ts`, `src/lib/directory.ts` | the hard-coded data and helpers you are replacing |
| `src/components/rotation-editor.tsx`, `src/components/meetup-roulette.tsx` | the UI whose behaviour you must preserve; note `moveItem`/`reorder` and the offset the editor draws from |
| `tests/server/factories.ts`, `tests/server/api-quotes.test.ts` | `authedRequest`/`sessionCookie`, and how handlers are tested with plain `Request` objects |

## 3. The rotation is one document

A single collection, `rotation`, holding **one** document — the current
rotation, in order.

```ts
interface RotationDoc {
  /** Fixed singleton key. Every read and write targets this exact _id. */
  _id: "current";
  /** Rotation order IS array order. Only people currently in the rotation. */
  members: {
    /** users._id. The FK a theme's broughtById/guessedById also points at. */
    userId: ObjectId;
    /** Hebrew conjugates the verb ("מביא"/"מביאה"); no directory carries it. */
    gender: "m" | "f";
  }[];
  updatedAt: Date;
}
```

Why one document:

- **Reorder is one atomic write** — replace `members`. That is also why
  last-write-wins needs no special handling: the last `$set` of the array is
  simply the state. Two simultaneous editors are vanishingly rare on this team,
  and the later save winning is acceptable and requires no conflict machinery.
- **The order lives in one place**, not smeared across per-row `order` integers
  that can go non-dense or collide.

The document owns **sequence and gender, nothing else**. Identity — name, title,
`directoryId`, and the theme history that FKs against it — lives in the `users`
row. `members[i].userId` is the join, and it is the same `_id` a theme names, so
nothing has to be reconciled between the two.

**Addressing the singleton:** always `findOneAndUpdate({ _id: "current" }, …,
{ upsert: true })`. A fresh database has no document; the first write creates it.
Reads tolerate its absence and return an empty rotation. Never `insertOne` — an
upsert keyed on the fixed `_id` is the only way in, and it makes every mutation
idempotent against a missing document.

## 4. Removing is forgetting

Per the product decision: the rotation document holds only current members. **A
person who leaves is spliced out of `members` and not remembered anywhere in
this collection.**

This is safe because their `users` row persists — it carries their identity and
is the target of every theme they ever brought, none of which this collection
touches. To bring them back you search the directory again (§6) and re-add them;
the add resolves to their **existing** `users` row by `directoryId`, so their
`_id` is unchanged and their past themes still attribute to them. What is lost is
only the convenience of a "return to rotation" list, and their gender, which is
re-asked on re-add.

**Consequence for the UI (§9):** the editor's "לא בסבב" section and its
`Former` component are **removed**, along with `RosterMember.active` and the
reactivate flow. Removing a row deletes it; there is no inactive state.

## 5. The rotation math is unchanged

Keep the design already in `team.ts` and already tested:

- Turn is `weeksElapsed % members.length` from `ROTATION_ANCHOR` — **no stored
  cursor**, so every viewer computes the same schedule and a quiet week never
  desyncs it.
- All weekday arithmetic in **UTC**, because `formatMeetupDate` renders in UTC.
- The meetup on meetup day is still *this week's*.
- "Now" is fixed by the server page and passed down as `nowIso`.

The only change: the ordered array is `rotationDoc.members` resolved to their
`users` rows, instead of the `ROSTER` constant.

**Write down and test the accepted consequence:** because the turn is
`weeksElapsed % members.length`, adding or removing anyone shifts everyone's
upcoming turn. Past turns are safe — themes record who actually brought — so this
is acceptable, but it is a property, not a surprise. Add a test for it.

## 6. The directory people-search (real, now)

The mock `src/lib/directory.ts` is **deleted**. The editor searches the real
directory through `ldap.ts`, which is already `server-only`.

### 6.1 `findPeople(query)` — the search

```ts
export async function findPeople(query: string): Promise<DirectoryPerson[]>

export interface DirectoryPerson {
  directoryId: string;   // objectGUID canonical string, or entryUUID
  displayName: string;
  title: string | null;
  username: string;      // first login attr, for disambiguating same names
}
```

- Substring filter built from the **configured** `LDAP_USER_FILTER` /
  `LDAP_LOGIN_ATTRS`, so a plain LDAP server works and the `ldap` test project
  can exercise it: `(&<userFilter>(|(displayName=*q*)(<loginAttr>=*q*)…))`.
- **Escape `q` with `escapeFilterValue` before adding the `*` wildcards.** This
  is the RFC 4515 invariant, and it is the easy place to get it wrong: you are
  deliberately adding `*`, so escape the value first, then wrap. A test must
  assert the filter string produced for `admin)(objectClass=*`.
- Runs on the **service-account bind** — the read-only path `findUser` already
  uses. It binds as nobody's account, so it can never touch a colleague's
  `badPwdCount`. Do **not** add a third bind.
- Reject `query.trim().length < 2` before opening a connection. `sizeLimit: 25`,
  `timeLimit: 5`. Returns `[]` on no match.
  - **Superseded.** This shipped as written and was then rewritten for speed: a
    leading wildcard cannot use an index, so `*typed*` made the DC read every
    user object under the base DN per keystroke. The filter is now chosen by
    `LDAP_SEARCH_MODE` (default `anr`), the limit by `LDAP_TIMEOUT_SECONDS`
    (default 30), and the service connection is pooled. See CLAUDE.md, "Why that
    search is fast".)
- Ask for `title` in the search attributes. `BASE_ATTRIBUTES` in `ldap.ts` does
  not currently request it and `DirectoryUser` has no field for it — add both,
  since the editor, the wheel's upcoming list and the standings all render a
  role. (The themes spec may already have done this; if so, reuse it.)
- Distinguish outcomes exactly as `findUser` does: a thrown `ConfigError` →
  `misconfigured`, a directory failure → `unavailable`. `findPeople` returning a
  plain array is the success path; surface the two faults to the route (§7.1) so
  it can map them to 500 vs 503.

### 6.2 `findPersonById(directoryId)` — re-resolve on add

The client posts a `directoryId`, never a name, and the server re-reads that
person and writes the fields itself, so nothing typed by a client lands in
`users.displayName`.

```ts
export async function findPersonById(directoryId: string): Promise<DirectoryPerson | null>
```

**The sharp part.** With a string id attribute (`entryUUID`) the filter is
ordinary. With `objectGUID` the value in a filter must be the **16 raw bytes as
`\xx` escape pairs in AD's mixed-endian order** — the canonical dashed string
matches nothing. `guidToString` already encodes that byte order one way; write
its inverse beside it and **test the two as a round-trip property** over
generated byte arrays, not against one hand-copied constant.

If you would rather not write the encoder, re-reading by the entry's `dn` with
`scope: "base"` is a legitimate alternative — the add happens seconds after the
search, so the `dn` is fresh. Pick one, say which in the module comment, and do
not do both.

## 7. API

Copy the quotes handlers' guard order: `isSameOrigin` → 403; session → 401
**before the body is parsed**; then 422 with `issues` keyed by field; 500 with a
Hebrew message and a `console.error`. Every route `export const dynamic =
"force-dynamic"`.

### 7.1 `GET /api/directory?q=…` — **requires a session**

The one deliberate departure from "GET stays public everywhere." This is not app
content; it is a window onto the staff directory, and there is no reason it
should answer anonymously. The air-gapped-network posture in `CLAUDE.md` accepts
the enumeration `?q=` on quotes *already* allows — it is not a licence to add a
new and better one. **Record this in `CLAUDE.md`** next to the public-reads note.

- `q` under 2 chars → `200 { people: [] }`, no directory call.
- Success → `{ people: DirectoryPerson[] }`. Pass only the four
  `DirectoryPerson` fields to the browser — never `dn` or `mail`.
- `unavailable` → 503, `misconfigured` → 500, matching the login route's split.

### 7.2 `GET /api/rotation` — **public**

The wheel is a public read, so the rotation is too. Returns the members resolved
to `{ userId, name, title, gender }` in order. Reads the data layer; no auth.

### 7.3 Mutations — all require a session

- `POST /api/rotation` — body `{ directoryId, gender }`. `findPersonById`
  re-resolves; upsert the `users` row on `directoryId`; append
  `{ userId, gender }` to `members`. `201` with the new member.
  - Unknown `directoryId` → **422** on that field (invalid input, not a 500).
  - Already in `members` → **409** ("כבר בסבב"); the editor offers no button, so
    this is a race.
- `DELETE /api/rotation/[userId]` — splice from `members`. Removing the **last**
  member → **409** (an empty rotation has nobody to bring refreshments and no
  slot to render). `204` on success. Unknown/malformed `userId` → 404.
- `PUT /api/rotation/order` — body `{ ids: string[] }` (users._id hex, in the
  new stored order). Replace `members` reordered to match. **Last-write-wins:**
  store what you are handed, no stale-set check. Reject only malformed input —
  an id that is not in the current `members`, a duplicate, or a length mismatch
  → 422; that is input validation, not concurrency control.
- `PATCH /api/rotation/[userId]` — body `{ gender }`. Update that entry. 404 if
  absent.

`PUT /api/rotation/order` and the editor: the client sends the **stored** order.
It already computes it — it drew the list from the stored order rotated by
`rotationIndex(currentMeetup(now), size)` and applied its drag with the pure
`moveItem`, then turns the displayed cycle back with `reorder`. Keep `moveItem`
and `reorder` client-safe and unchanged; they are what makes the wrap correct.

## 8. Indexes and seeds

- `rotation`: the fixed `_id` is the only key; no extra index needed.
- The demo seed already creates a `users` row per rotation member (themes spec,
  §8). Extend it to also upsert the singleton `rotation` document with those
  members in the seeded order and a gender each. No-op if the document already
  has members. Must not need a reachable directory.

## 9. Frontend wiring

Keep the visual design and every interaction except the one removal below.

- **Delete the "לא בסבב" / former-members UI.** Remove the `Former` component,
  `RosterMember.active`, and the restore flow (§4). Removing a member calls
  `DELETE`; there is no inactive state to show.
- **`MeetupRoulette` stops owning the roster.** It takes `initialRoster` from
  the server page and reconciles a new `initialRoster` prop **during render**
  via a `seed` comparison, like `QuoteFeed` — `react-hooks/set-state-in-effect`
  is an **error** here, not a warning. Keep `editRoster` resetting `winner` /
  `rotation` / `duration`, and keep it running after a `router.refresh()`, or
  the spin state outlives the list it indexes into.
- **`RotationEditor` calls the API**, then `router.refresh()`. Its four actions
  map onto §7.3. Keep the optimistic feel — it is a dialog over a wheel, and a
  spinner between every drag would be worse than today.
- **The directory search debounces** and calls `GET /api/directory`. Keep the
  two-character floor and the "לפחות שתי אותיות" state — they are now also the
  server's rule.
- Gate the editor's affordances on `useSession` for UX; the API's 401 is the
  enforcement.
- Delete `ROSTER` and `DIRECTORY` once nothing imports them.

## 10. Tests

`npm test` stays Docker-free and green; do not add a vitest project.

**`tests/server/rotation.test.ts`** — data layer:
- add appends and re-resolves through the directory: a body carrying a
  `displayName` does not change what is stored
- adding someone whose `users` row already exists (they were removed earlier)
  reuses that `_id` — assert it is unchanged and a theme pointing at it still
  resolves
- remove splices; removing the last member is refused
- reorder stores the handed order verbatim (last-write-wins), and rejects a
  malformed set (missing / unknown / duplicate id, wrong length)
- **`reorder` round-trips**: for every offset `0…n-1`, storing the displayed
  order and re-deriving the display yields the same list — the property the
  editor depends on and the one an offset-based store gets wrong at the wrap
- the rotation reads from `members` in array order; removing a member shifts
  upcoming turns but leaves recorded themes untouched
- keep every existing UTC / anchor / meetup-day assertion passing

**`tests/server/api-rotation.test.ts`** — the contract, plain `Request` +
`authedRequest`:
- 401 on every mutation without a session, asserted for a malformed body too
  (session precedes parse); 403 on `Origin` mismatch
- `GET /api/rotation` works with no session; `GET /api/directory` without a
  session is 401
- `POST` unknown `directoryId` → 422; already-present → 409
- `DELETE` last member → 409; unknown/malformed id → 404
- `PUT /order` stores a valid set densely; a stale/duplicate set → 422 and
  writes nothing
- ids and names in a body are ignored in favour of the lookup

**`tests/server/ldap.test.ts`** — against the fake client:
- the GUID encoder/decoder round-trip (§6.2) over generated byte arrays
- `findPeople` escapes RFC 4515 metacharacters **before** adding wildcards —
  assert the filter for `admin)(objectClass=*`
- a query under two characters opens no connection

**`tests/ldap/`** — extend; stays excluded from `npm test`, still skips when
nothing listens on `:1636`. Cover `findPeople` returning real substring matches
from the container, and that it works with `entryUUID` as the id attribute.
(That suite now pins `LDAP_SEARCH_MODE=substring` itself — OpenLDAP implements no
`anr`, which is the production default.)

**`tests/ui/`** — the rewired editor: a drag issues one `PUT /api/rotation/order`
with the stored order; add posts `{ directoryId, gender }`; the former-members
section is gone. `respondWith()` from `tests/ui/factories.ts` for fetch mocks —
a bare `mockResolvedValue(new Response(...))` breaks on the second call.

## 11. Invariants you must not break

- Dates in UTC; meetup day is still this week's; the rotation stays anchored,
  never a stored cursor.
- LDAP filter values are RFC 4515-escaped — including, and especially, the
  substring search where you add wildcards yourself.
- No bind with an empty password; every directory read here uses the
  service-account bind and must not touch `badPwdCount`.
- `isSameOrigin` compares `Origin` to `Host`/`X-Forwarded-Host`, never
  `new URL(request.url)`.
- Handlers read the session off the `Request` via `getSessionFrom`, never
  `next/headers`.
- `ConfigError` → `misconfigured` → 500 stays distinct from a directory outage
  → `unavailable` → 503.
- New env vars read lazily. New route → `npx next typegen`. New user-facing
  strings, error messages included, in Hebrew.

## 12. Definition of done

```bash
npm test            # green, no Docker
npx tsc --noEmit    # clean
npm run lint        # clean
npm run build       # succeeds with no MONGODB_URI
npm run ldap:up && npm run test:ldap && npm run ldap:down
```

Plus, by hand against a seeded database: a drag survives a reload; searching the
directory and picking someone puts them on the wheel; removing someone shifts the
schedule and leaves their past themes reading correctly; re-adding a removed
person restores them without duplicating their identity or losing their history.

`CLAUDE.md` updated for: the `rotation` collection and its singleton shape, the
removal of the former-members UI, the session requirement on `/api/directory`,
and the deletion of the mock directory. Tone is *why, not what* — match the
density of what is there.

## 13. Flag rather than guess

- A rotation member has no `objectGUID`, or the directory uses `entryUUID` —
  confirm which `LDAP_ID_ATTR` is in play before writing the §6.2 encoder.
- The directory returns two people with the same `displayName` — the editor
  shows the username to disambiguate; confirm that is enough for this team.
- You find yourself wanting per-member `order` integers, an `active` flag, or a
  second collection — that is the single-document decision (§3, §4) unravelling;
  raise it rather than quietly widening the schema.
