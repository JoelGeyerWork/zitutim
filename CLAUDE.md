@AGENTS.md

# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A hub for one team, Hebrew-native and RTL throughout; all user-facing strings
are Hebrew. It is organised as **sections**, and `/` is a landing page that
links into them rather than being a section itself:

| Route | What |
|---|---|
| `/` | the hub — this week's ישב״צ, and a teaser per section |
| `/quotes`, `/quotes/search`, `/quotes/create` | the quote wall: who said something, when, and what led to it |
| `/meetups`, `/meetups/themes` | the weekly ישב״צ, the refreshment rotation, and the theme-guessing game |
| `/login` | — |

Navigation is exactly two levels, both in the header at every screen size: a
**dropdown picks the section**, and a **tab bar moves around inside it**. There
is no mobile bottom bar — the dropdown replaced it, which is what lets a section
grow a fourth page without the nav being redesigned again. Below `sm` the tabs
wrap to their own row rather than being squeezed into a strip too narrow to show
one whole pill.

### `src/lib/navigation.ts` is the single source of truth

`SECTIONS` drives the dropdown, the tab bars **and** the hub's cards. **Adding a
section is one entry there plus its route folder** — it then appears everywhere
on its own. Optionally: register a richer hub card in the `teasers` map in
`src/app/page.tsx` (without one the card falls back to the section's
`description`), and give the page a `metadata.title` — the root layout's
`title.template` appends `· מרכז הצוות`, so no page spells the suffix itself.

Pages use `PageShell` + `PageHeader` (`src/components/page-shell.tsx`) rather
than repeating the container and heading markup, so a new section inherits the
measure and rhythm.

Four things that bit here:

- **Base UI radio items default to `closeOnClick: false`.** Right for the theme
  picker, wrong for the section links: navigation is client-side, so without
  the explicit prop the menu is left hanging over the page it just moved you to.
- **A section owns its subtree, but `/` is a prefix of everything.** `sectionFor`
  special-cases the root to an exact match; a naive `startsWith` lights up every
  section at once. It also checks the `/` boundary, so a future `/quoteshub`
  isn't swallowed by `/quotes`. Tabs match exactly, since each is one page.
- **The tab bar is drawn only for `tabs.length > 1`.** A lone tab is a label for
  the page you are already on.
- **`HUB` is kept out of `SECTIONS`.** It is in the picker like a section but
  owns no content, so the hub page maps `SECTIONS` without having to filter
  itself out of its own card list.

Public read, login to write: anyone who can reach the app can browse and search,
but adding, editing and deleting need a session. Sign-in binds against the
organisation's Active Directory over LDAP.

### The rotation is still hard-coded — the themes are not

The **theme-guessing game is persisted** (`themes` collection, its REST API,
server-computed standings — see the quotes-shaped data layer below). What is
still hard-coded is the **rotation**: whose turn it is, and the roster it turns
through. These three modules stay client-safe on purpose (no `server-only`) so
the roulette can spin and the rotation can be edited locally, and there is no
collection or API behind them yet:

| Module | Stands in for |
|---|---|
| `src/lib/team.ts` | the meetup slot, the date arithmetic, and `TEAM` |
| `src/lib/directory.ts` | Active Directory — objectGUID, displayName, title |
| `src/lib/roster.ts` | who is in the refreshment rotation, and in what order |

The split between the last two is the design being tried out, not an artefact of
mocking: **the directory owns identity, the app owns membership.** A rotation
entry is a directory person — name, title and immutable id all read from there —
plus the three things AD has no concept of: turn order, grammatical gender, and
whether they are still in the rotation. Adding someone is *picking them out of
the directory*, never typing a name, so they arrive carrying the objectGUID that
`upsertUserFromDirectory` already keys `users` on. In Mongo this is a `roster`
sub-document on the existing `users` row, not a second collection — splitting it
out forks the same person into two ids the moment a rotation member signs in.
Nobody is ever deleted, only deactivated: their name is on the themes they
brought.

Editing lives behind the pencil beside the wheel (`RotationEditor`), not on a
page of its own — it changes the wheel, and it is not a team-management screen.
Order is set by dragging the rows.

Four things that bit here:

- **The rotation is anchored to a date, not a stored cursor.** `ROTATION_ANCHOR`
  plus the number of weeks elapsed gives whose turn it is, so every viewer sees
  the same schedule and a week nobody opened the app doesn't desynchronise it.
  The cost is that the turn is `weeksElapsed % rotationSize`, so **adding or
  removing anyone moves everyone's upcoming turn** — visible immediately in the
  editor. Past turns are safe; a theme records who actually brought it.
- **"Now" is fixed by the server page and passed in as `nowIso`.** A
  `new Date()` on both sides of hydration disagrees across a midnight or a week
  boundary, and the roulette would hydrate onto a different person than it
  rendered.
- **The editor hands back the whole visible order, and `reorder` stores it.**
  The list is drawn from whoever is up this week, so the row below you is not
  the next entry of the stored order — at the wrap it is the first one. Turning
  the displayed cycle back by the same offset is exact in a way that
  translating an individual move is not.
- **The drag is tracked on `window`, and moves nothing in the DOM.** The held
  row is lifted and translated to follow the pointer while its neighbours step
  aside by one row; the list only re-orders on drop. The whole row is the
  handle, so `[data-no-drag]` marks the controls that keep their own gestures,
  and the row itself is focusable and answers the arrow keys — there is no grip
  to tab to. **On touch it takes a hold first** (`HOLD_MS`, cancelled by
  movement past `HOLD_SLOP`): a row that grabbed on contact would take the
  dialog's scroll with it, and refusing that scroll afterwards needs the
  non-passive `touchmove` listener the drag effect adds.
- **The wheel alternates two tones, which fails at an odd count** — the first
  and last slice meet, and the rotation is editable, so odd is not an edge case.
  `toneOf` gives the closing slice a third, neutral tone.

`TEAM` has not gone away: `memberOn` and the themes data layer still read it, so
there are currently two lists of the same people. Whichever of the two survives,
they should be one. **The themes FK papers over the gap by matching a `TEAM`
member to a `directory.ts` person by display name** (`ROSTER_BRIDGE` in
`themes.ts`, the same map the demo seed hard-codes), to recover the objectGUID
its `users` row is keyed on. That match is exact and offline, and it means a
roster member who later signs in through LDAP lands on the *same* `users` row a
theme already references rather than forking — but it only holds because both
lists still describe the same eight people. Collapsing the two lists is what
finally removes the bridge.

### It runs on an air-gapped network

Internal-only, and everyone who can reach it is staff. That deliberately lowers
the priority of hardening aimed at an outside attacker — enumeration, open
redirects, verifying the DC's certificate — and the trade-offs already accepted
on those grounds are recorded where they apply: `LDAP_TLS_INSECURE` under TLS,
the login `429` oracle under the auth invariants.

It excuses neither of these, because neither needs an attacker:

- **The login throttle is not a security control.** Every failed bind increments
  `badPwdCount` on a real AD account, so it exists to stop a double-submit or a
  retry loop from locking a colleague out of *Windows*.
- **Availability bugs are still bugs** — a throttle you can't wait out, a
  same-origin check that 403s every write, a sign-out that does nothing. All
  three shipped here before review caught them.

## Commands

```bash
npm run db:up          # MongoDB in Docker on :27017 — needed before dev
npm run db:seed:demo   # indexes + sample quotes (no-op if the collection is non-empty)
npm run dev
npm run build
npm run lint
npx tsc --noEmit       # there is no typecheck script; build runs tsc too
npx next typegen       # regenerate .next/types after adding a route
```

`LayoutProps<"/">` and `PageProps<"/login">` come from `.next/types`, which
`tsconfig.json` includes. Add a route without regenerating and `tsc` reports a
phantom "cannot find name" on a file you did not touch.

`npm run db:seed` creates the indexes without the sample data. `npm run db:down`
stops Mongo but keeps the `mongo-data` volume.

`npm run app:up` / `app:down` build and run the containerised app alongside
Mongo. The `app` service sits behind a compose profile precisely so `db:up`
(plain `docker compose up -d`) keeps meaning "Mongo only" for the dev loop.

Profiles cut the other way on teardown: `db:down` is *also* profile-less, so
with the stack up it removes Mongo, leaves `zitutim-app` running, and then fails
to remove the network it's still attached to. Use `app:down` to stop the stack.

The `app` service takes `SESSION_SECRET` and the `LDAP_*` block through
`env_file: .env.local`, with `environment:` still overriding the two Mongo
values. Compose auto-loads only `.env`, and only for `${...}` interpolation —
`env_file` is a separate mechanism that reads the path it is given, so naming
the file is what makes this work. Two consequences worth keeping: no secret
lands in a committed file or in the image, and a missing `.env.local` fails
`app:up` outright instead of building a container that starts healthy and cannot
be signed in to. Note `LDAP_TLS_CA` is a *host* path — mount it, or leave it
unset.

Requires `.env.local` (`cp .env.example .env.local`). Both seed scripts read it
via `node --env-file`, so they fail without it. Beyond Mongo it needs a
`SESSION_SECRET` (`openssl rand -base64 32`) and the `LDAP_*` block; without a
reachable domain controller everything still runs, sign-in just reports the
directory as unavailable.

### Tests

```bash
npm test                                          # both projects
npm run test:server                               # node project only
npm run test:ui                                   # jsdom project only
npm run test:watch
npx vitest run --project server tests/server/quotes.test.ts    # one file
npx vitest run --project ui -t "highlights the search term"    # one test by name
```

`npm test` needs **no** Docker and no dev server: `mongodb-memory-server` starts
a throwaway Mongo per run, and route handlers are called directly with `Request`
objects. The first run downloads and caches a Mongo binary. Keep it that way —
`test` names its two projects explicitly so a new project can't silently join it.

```bash
npm run ldap:up        # OpenLDAP on :1636 from docker-compose.ldap.yml
npm run test:ldap      # the `ldap` project — skips entirely if nothing is listening
npm run ldap:down      # stops it and drops the volumes
```

The `ldap` project drives the real `authenticate()` against a real directory:
real BER encoding, a real TLS handshake, a real bind. It is **not** AD, so it
covers the two-bind flow, RFC 4515 escaping, LDAPS, the empty-password guard and
the identity mapping, but cannot produce objectGUID byte order or the AD error
sub-codes — `tests/server/ldap.test.ts` still covers those through a fake client.

`ldap:up` generates a self-signed certificate into `.ldap/certs/` first — the one
baked into `osixia/openldap:1.5.0` expired in January 2026. Three quirks of that
image are already handled in `docker-compose.ldap.yml`, and all three present as
the same opaque `ECONNRESET` if you undo them: it demands a client certificate
unless `LDAP_TLS_VERIFY_CLIENT=never`; it generates DH parameters *after* port
389 starts answering, so the healthcheck has to probe **LDAPS on 636** or it goes
green while TLS is still dead; and an anonymous search returns "no such object"
even for entries that exist, so the healthcheck binds as admin.

`LDAP_TLS_INSECURE=true` skips certificate verification. The connection stays
encrypted — what it drops is authenticating the server, which allows an active
MITM to harvest domain passwords. It is set for the local container and accepted
in production on the grounds that the network is air-gapped; on anything routable
`LDAP_TLS_CA` is the right answer instead.

## Architecture

### The server/client module split is load-bearing

`src/lib/quotes.ts` is the Mongo data layer and is marked `server-only`.
`src/lib/quote-schema.ts` holds the `Quote`/`QuotePage` types, `PAGE_SIZE`,
`SORT_OPTIONS`/`SORT_LABELS`, and the Zod schema — and imports nothing from
`mongodb`.

**Client components must import from `@/lib/quote-schema`, never `@/lib/quotes`.**
`quotes.ts` re-exports everything from the schema module, so server code can use
the one import. Pulling `@/lib/quotes` into a `"use client"` file drags the Mongo
driver into the browser bundle.

Themes are the same pattern: `src/lib/theme-schema.ts` is client-safe (`Theme`,
`ThemePage`, `Standing`, `ThemeMember`, `themeInputSchema`, `placeOf`, and it
reuses `dateOnly` from `quote-schema.ts`), and `src/lib/themes.ts` is the
`server-only` Mongo layer that re-exports it. Standings are computed *there*,
across every theme via aggregation — `getStandings`/`getThemeStats`, not a
reduction over the loaded page, which would silently rank only what the client
holds once the list paginates.

Auth mirrors the same split, with the same consequence — `ldapts` and `jose` in
the browser bundle:

| Module | Marker | Who may import |
|---|---|---|
| `src/lib/auth-schema.ts` | none — **client-safe** | client + server |
| `src/lib/session.ts` | `server-only`, re-exports the schema | server |
| `src/lib/ldap.ts` | `server-only` | server |
| `src/lib/users.ts` | `server-only`, re-exports the schema | server |
| `src/lib/login-throttle.ts` | `server-only` | server |
| `src/lib/config-error.ts` | none — one `Error` subclass, no deps | anywhere |

### Data flow

Pages are server components that call `listQuotes`/`getStats` directly (no HTTP
hop) and hand the first page to a client component. Mutations go the other way,
through `fetch` to the REST API, then `router.refresh()` to re-run the server
component. `QuoteFeed` reconciles a new `initial` prop **during render** via a
`seed` state comparison rather than in an effect — `react-hooks/set-state-in-effect`
is an error in this config, not a warning.

`src/app/api/quotes/route.ts` and `[id]/route.ts` re-validate every mutation with
the same `quoteInputSchema` and return `422` with `issues` keyed by field name;
`QuoteForm` renders those inline. The form's own checks are for responsiveness
only — the server is the authority.

### Auth

**The app process handles every employee's real domain password.** That is a
genuine change in what this codebase is, and it drives most of the rules below:
HTTPS-only in production, `ldaps://` to the DC, and never logging a request body
on the login route.

`ldap.ts` does a **two-bind** dance, split across two exported functions:
`findUser()` binds as the read-only service account and searches, then
`verifyPassword()` binds a *second, separate* client as the DN the server
returned. Binding against the returned DN — rather than templating one out of
user input — is why no RFC 4514 DN escaping exists anywhere here. Two clients
rather than a rebind because a failed rebind leaves the connection in an
undefined bind state.

The split exists so the **login route can throttle between the two halves**. The
search runs as the service account and never touches `badPwdCount`, so it is
safe to run unmetered, and it is the only way to learn which directory object a
typed string refers to. `authenticate()` runs both halves and is for callers
with no such need — the route does not use it.

How the directory spells identity is configuration, not code:
`LDAP_USER_FILTER`, `LDAP_LOGIN_ATTRS` and `LDAP_ID_ATTR` default to AD's
`objectClass=user` / `sAMAccountName` / `objectGUID` and can be pointed at
`inetOrgPerson` / `uid` / `entryUUID` for a plain LDAP server — which is what
makes local testing possible without an AD. Only `objectGUID` is requested as a
binary attribute and GUID-decoded; every other identifier is used as a string.
Note there is **no `userAccountControl` filter clause**: AD refuses to bind a
disabled account anyway (sub-code `533` → `credentials`), so excluding it from
the search bought nothing and cost the bitwise matching rule.

The AD error sub-codes degrade on their own — a directory that doesn't emit them
falls through to the generic `credentials` message.

Sessions are a stateless HS256 JWT (`jose`) in an httpOnly cookie holding only
`{ sub, name, username }`. A disabled AD account therefore stays valid until it
expires — `SESSION_TTL_HOURS`, default 8. The cheap escalation, if that ever
matters, is a `disabledAt` check on the *write* paths only: mutations already hit
Mongo, so it costs one indexed lookup, whereas checking it in `getSession()` puts
a database read on every public page view.

**Route handlers read the session off the `Request`** (`getSessionFrom`), not via
`next/headers`. The server suite calls handlers directly with plain `Request`
objects, where there is no Next request scope and `await cookies()` throws. Only
`getSession()` — for server components, wrapped in React `cache()` — touches
`next/headers`.

Error contract: `401 { error }` on a mutation without a session, checked **before**
the body is parsed so validation behaviour isn't an oracle for anonymous probes;
`403` on an `Origin` mismatch; `429` with `Retry-After` from the login throttle.
`GET` stays public everywhere.

**A configuration fault is not a directory outage**, and the two are kept apart
deliberately — they send whoever investigates to opposite places. Anything
thrown by the lazy config readers is a `ConfigError`: `ldap.ts` turns it into
the `misconfigured` reason (→ `500`, not the `unavailable` `503`), and the login
route catches it around `signSession` too, which is the sharp one — an unset
`SESSION_SECRET` throws on the line *after* the directory said yes, so without
that branch the one person whose password definitely worked is told the
directory is unreachable.

`src/instrumentation.ts` runs the same two config readers once at boot, so a
missing variable surfaces at deploy rather than at the first sign-in — the
public read path verifies no token and talks to no directory, so a badly
configured container otherwise starts, reports healthy, and serves the feed
perfectly for a day. It **logs and keeps going rather than throwing**: throwing
from `register()` does not stop the process the way it appears to. Next reports
"Failed to prepare server", holds the port, and serves `500` for *every* route —
so a mistake in the login config would take the reading down with it, and
reading is most of what this is for.

The session reaches client components through `SessionProvider` (read once in the
root layout). **It is display state, not a security boundary** — hiding the card
menu is UX, the API's 401 is the enforcement.

**Signing in and out use a full document navigation** (`window.location.assign`
/ `.reload()`), not `router.replace()` / `router.refresh()`. Auth state is baked
into the root layout, so every entry already in the client Router Cache — from a
visit *or* a `<Link>` prefetch — is stale the moment the cookie changes.
`router.refresh()` does not fix it: it is fire-and-forget, so a navigation on the
next line consumes the stale entry first and you land signed in looking at a
"כניסה" button. Reloading is the only thing that reliably re-renders the whole
tree against the new cookie, and it costs one page load per login.

### Invariants worth not breaking

- **`saidAt` is stored at UTC midnight and formatted in UTC** (`src/lib/format.ts`).
  Formatting it in local time shifts the day backwards west of Greenwich. Meetup
  dates follow the same rule — `currentMeetup` does its weekday arithmetic in
  UTC because `formatMeetupDate` renders in UTC.
- **The meetup on meetup day is still "this week's".** Rolling the rotation over
  at midnight tells whoever is bringing the refreshments that their turn is
  eight days away, on the morning they are meant to bring them.
- **Every entry in `sortSpecs` ends in `_id`.** Without a total order, offset
  pagination shows a quote twice or skips it when sort keys tie.
- **Search escapes regex metacharacters** before building the `RegExp`. `.*` must
  match the literal text, not everything. `Highlighted` in `quote-card.tsx` does
  the same escaping client-side.
- **LDAP filter values are RFC 4515-escaped** (`escapeFilterValue`) — the sibling
  of the rule above. Unescaped, `admin)(objectClass=*` restructures the filter
  into a match on the first user in the directory.
- **A bind is never attempted with an empty password.** RFC 4513 makes that an
  *unauthenticated* bind: AD returns success and downgrades to anonymous, so
  reading "the bind resolved" as "the password was correct" logs anyone in as
  anyone. The same applies to an unset `LDAP_BIND_PASSWORD`, which is why the
  config reader rejects it.
- **Login throttles below the AD lockout threshold** (3 in 10 minutes, vs. a
  typical policy of 5). Without it, an anonymous visitor can lock the whole
  company out of *Windows* by iterating usernames. Three details are load-bearing
  and each was a bug once:
  - the bucket is keyed on the **resolved `directoryId`**, not the typed string,
    or every alias in `LDAP_LOGIN_ATTRS` gets its own budget against one account;
  - `consumeAttempt` counts and decides in **one atomic step**, before the bind,
    or concurrent requests all read the same pre-increment count and all bind;
  - a lapsed window **restarts** the count rather than extending it, or one
    further mistake after the wait throttles you again immediately.

  Every failure path is also held open to a fixed floor, or response time tells a
  nonexistent username from a wrong password.

  **Accepted, and only accepted because the network is air-gapped:** throttling
  after the search makes the 429 an account-existence oracle — a real username
  answers differently on the fourth attempt, an unknown one never does. It is a
  weaker version of the staff-name enumeration `?q=` already allows. If this app
  ever leaves the air-gapped network, that and the unmetered service-account
  searches for usernames that resolve to nothing (capped today only when
  `LOGIN_TRUSTED_PROXY=true`) fall out together, and a per-typed-string bucket
  consumed *before* the search closes both without disturbing any of the
  directory-keyed work.
- **`isSameOrigin` compares `Origin` to the `Host` header**, never to
  `new URL(request.url)`. Next builds that URL from the server's own bind
  address — `HOSTNAME=0.0.0.0` in the Dockerfile — so comparing against it 403s
  every real client while passing in `next dev` on localhost.
  `X-Forwarded-Host` wins when present, and is trusted unconditionally: a
  browser doing a cross-site request cannot forge it, and gating it behind a
  config flag would only 403 whoever forgot to set the flag.
  **The comparison includes the port**, so if the app is ever published on a
  non-default port, the proxy must put it in `X-Forwarded-Host` — many proxies
  send the bare hostname and carry the port in `X-Forwarded-Port` instead, which
  is invisible on 80/443 (the browser omits those from `Origin` too) and then
  403s everything the day the port changes. That is the same symptom as getting
  the comparison wrong in the first place, so suspect it first.
- **`safeNext` rejects tab, LF and CR.** The URL parser deletes them before
  parsing, so `/<TAB>/evil.com` resolves to another host without ever starting
  `//`.
- **`updateQuote` never touches `addedBy`/`addedById`.** Any signed-in user may
  edit any quote, so stamping the editor there would silently transfer
  authorship; the edit is recorded in `updatedBy`/`updatedById` instead.
  `addedBy` is a display-name *snapshot*, kept denormalized because it is
  rendered directly and is one of the four regex-searched fields.
- **`SESSION_SECRET` and every `LDAP_*` var are read lazily**, like `MONGODB_URI`.
  A module-scope read captures `undefined` under vitest, which sets env in
  `beforeAll` after imports have run.
- **`output: "standalone"` in `next.config.ts` is what the Dockerfile runs.**
  Remove it and the runtime stage has no `server.js` to start. The standalone
  bundle deliberately excludes `.next/static` *and* `public/`, so each needs its
  own `COPY` in the runner stage. `.next/static` has one; drop it and the app
  serves unstyled HTML. There is no `public/` yet — **the first file added there
  needs a `COPY` too**, or it will work under `dev` and `next start` and 404
  only inside the container, with nothing in the build output to explain why.
- **The feed page stays `force-dynamic`.** It's why `next build` needs no
  `MONGODB_URI`, and therefore why the image builds without a database.
- **Red/white/black palette** — red is the only chromatic hue, everything else is
  a pure neutral, in both schemes. `next-themes` puts `.dark` on `<html>`
  (`ThemeProvider` in `layout.tsx`, picker in `theme-toggle.tsx`), and
  `globals.css` pins `color-scheme` to whichever is resolved so native controls —
  notably the date picker — follow the site rather than the OS. New surfaces must
  use the tokens; a literal colour will be wrong in one scheme. Elevation flips
  between the two: light tints the page *behind* the cards, dark leaves the page
  at `--background` and lets the cards sit lighter (`bg-muted/40 dark:bg-background`
  on `<body>`).

### RTL

`components.json` has `"rtl": true`, so shadcn generates components with logical
properties (`ps`/`pe`, `start`/`end`, `rtl:` variants). Regenerate rather than
hand-patching for direction. Use logical properties in new code too. Note that
directional *icons* are a separate judgment call: the "לפיד" arrow in
`create-quote-view.tsx` is deliberately not mirrored, because onward reads
leftward in RTL.

Hebrew counts need `plural()` from `src/lib/format.ts` — a bare numeral reads
badly at 1 ("1 תוצאות").

## UI library

shadcn/ui on **Base UI** (`@base-ui/react`), not Radix. Consequences that bite:

- Composition uses a `render` prop, not `asChild`.
- `<Button render={<Link/>}>` needs `nativeButton={false}`, or Base UI logs an
  error — but it also puts `role="button"` on the anchor. For something that
  navigates, prefer `<Link className={cn(buttonVariants(...))}>`, which is what
  `page.tsx`, `quote-feed.tsx` and `account-menu.tsx` all do.
- `DropdownMenuLabel` is `Menu.GroupLabel` and **must sit inside a
  `DropdownMenuGroup`**. Outside one it throws while the popup renders, so the
  menu simply never opens — no error you would connect to the cause.
- `<SelectValue>` takes children as a *function* of the value; without it the raw
  value renders instead of the label.
- Check the installed `.d.ts` under `node_modules/@base-ui/react/` when unsure —
  the API differs from Radix-era shadcn docs.

Dialogs are driven by controlled `open` state from the parent and mounted only
while open (see `quote-card.tsx`), rather than nesting triggers inside menu items.

Because these files are regenerated, styling that has to survive a regeneration
lives outside them: `globals.css` darkens the dialog and alert-dialog scrims in
dark mode via their `data-slot` attributes, since the stock `bg-black/10` is
invisible against a near-black page. Override by `data-slot` rather than editing
the generated class strings.

## Test environment quirks

All of these are already handled in `tests/setup/`; don't be surprised by them.

- `server-only` throws unless imported under Next's react-server condition, so
  `vitest.config.mts` aliases it to a stub.
- Node 26 defines its own `localStorage` global that stays `undefined` without
  `--localstorage-file` and shadows jsdom's. `tests/setup/dom.ts` substitutes a
  working in-memory `Storage`. Nothing currently reads it — the shim is kept so
  the next component that does isn't left rediscovering the shadowing bug.
- `tests/setup/env.ts` supplies `SESSION_SECRET` and the `LDAP_*` vars to the
  server project, and pins `LOGIN_MIN_RESPONSE_MS=0` so the login route's
  anti-timing-oracle delay doesn't slow the suite down.
- `vi.mock("ldapts")` replaces the error classes too, so `ldap.ts` identifies AD
  failures by duck-typed `code`, not `instanceof`.
- `mockResolvedValue(new Response(...))` breaks on the second call — a body can
  only be read once. Use `respondWith()` from `tests/ui/factories.ts` with
  `mockImplementation`.
- jsdom has no `matchMedia`, which `next-themes` calls on mount; `dom.ts` stubs it
  as "never matches", so `system` resolves to light under test. next-themes also
  writes on the real `<html>`, so tests that switch themes have to reset its
  class themselves.

## Conventions

- Comments explain *why*, not what. Most existing ones mark a non-obvious
  constraint; match that density rather than annotating the obvious.
- New user-facing strings are Hebrew, including API error messages.
- `addedBy` is a display-name snapshot taken from the session when a quote is
  created; `addedById` is the real reference into `users`. A client cannot set
  either — `quoteInputSchema` has no `addedBy` key, so anything sent under it is
  stripped rather than honoured.
- Any signed-in user may edit or delete any quote. No ownership check, no roles,
  no AD group mapping — deliberately, for a small high-trust team.
