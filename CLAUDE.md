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
organisation's Active Directory over LDAP. **The one read that still needs a
session is `GET /api/directory`** — it is a window onto the whole staff
directory, not app content, so it does not answer anonymously. The air-gapped
posture accepts the `?q=` enumeration quotes already allow; that is not a licence
to add a new, better one.

### The rotation is persisted, keyed to the directory

The **rotation is a single document.** The `rotation` collection holds exactly
one row, `_id: "current"`, with an ordered `members: [{ userId, gender }]` array.
Order *is* array position, so a reorder is one atomic `$set` and last-write-wins
needs no conflict machinery — the later save simply winning is acceptable on a
team this size. It is addressed only via `findOneAndUpdate({ _id: "current" }, …,
{ upsert: true })`: a fresh database has no document, the first write creates it,
and every read tolerates its absence and returns an empty rotation.

The document owns **sequence and gender, nothing else.** Identity — name, title,
`directoryId`, and the themes that FK against it — lives on the `users` row
`members[i].userId` names, the same `_id` a theme references, so there is nothing
to reconcile between the two. `getRotation` resolves the members to their rows;
`GET /api/rotation` is a public read, like the wheel it feeds.

| Module | Role |
|---|---|
| `src/lib/team.ts` | the meetup slot, the date arithmetic, `TEAM`, and the rotation math (`rotationIndex`, `rotate`, `buildRotation`) — client-safe |
| `src/lib/roster.ts` | client-safe still: the `RosterMember` shape and the pure `moveItem`/`reorder` order helpers the drag depends on |
| `src/lib/rotation.ts` | `server-only` Mongo layer: the singleton, `getRotation`, and the add/remove/reorder/set-gender mutations plus their Zod schemas |
| `src/lib/directory-schema.ts` | client-safe `DirectoryPerson` — the four fields (`directoryId`, `displayName`, `title`, `username`) safe for the browser |

**The directory search is real now.** `ldap.ts` grew `findPeople(query)` — a
service-account substring search that escapes with `escapeFilterValue` *before*
adding the `*` wildcards, refuses under two characters, and never opens a second
bind or touches `badPwdCount` — and `findPersonById(directoryId)`, which encodes
an objectGUID as `\xx` raw bytes in AD's mixed-endian order (`guidToBytes`, the
tested inverse of `guidToString`; a string `entryUUID` is escaped plainly). Both
throw on a directory fault and let a `ConfigError` propagate, so the route maps
them to 503 vs 500 exactly like login. The **mock `src/lib/directory.ts` is
deleted.**

**The directory owns identity, the app owns membership.** Adding someone is
*picking them out of the directory*, never typing a name: the client posts a
`directoryId`, the route re-resolves the person with `findPersonById` and
`upsertRosterUser` writes the row — so nothing a client typed lands in
`users.displayName`, and they arrive carrying the objectGUID `users` is keyed on.
Re-adding a removed member re-resolves to their **existing** row by `directoryId`
rather than forking, so their `_id`, and every theme that references it, is
unchanged.

**Removing is forgetting.** A member spliced out of `members` is not remembered
anywhere in this collection — no inactive flag, no "return to rotation" list, and
the editor's "לא בסבב" / former-members section is gone. Their `users` row and
every theme they brought survive untouched, so re-adding them via directory
search restores their identity and history; only their gender is re-asked.
Removing the **last** member is refused (409) — an empty rotation has nobody to
bring the refreshments and no slot to render.

Editing lives behind the pencil beside the wheel (`RotationEditor`), not on a
page of its own — it changes the wheel, and it is not a team-management screen.
Order is set by dragging the rows. Each action calls the REST API and then
`router.refresh()`; the list stays optimistic so a drag doesn't wait on a round
trip.

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

**`getThemeRoster` reads the rotation now**, resolved to `users` rows — so the
theme picker and the standings come from the same list the wheel does. That
retired the `ROSTER_BRIDGE` display-name match and the empty-picker-on-unseeded-
prod caveat both: the FK target and the picker are one source, the seed writes
the singleton, and the editor fills it. One seam is left — `memberOn` (the
themes-page "whose turn was it" header) still reads the hard-coded `TEAM`, so it
can drift from the DB rotation if the two lists of the same eight ever diverge.
It is a smaller seam than two rosters, and collapsing `TEAM` into the rotation is
what finally closes it.

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

`docker-compose.mail.yml` is a third profile-less file, like the LDAP one, so
`db:up` keeps meaning "Mongo only".

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

```bash
npm run mail:up        # Mailpit on :1025, web UI on :8025, from docker-compose.mail.yml
npm run test:mail      # the `mail` project — skips entirely if nothing is listening
npm run mail:down      # stops it and drops the volumes
```

The `mail` project is the same shape as `ldap`: a real SMTP conversation against
a throwaway sink, skipped when nothing answers on 1025, and out of `npm test` on
purpose. Mailpit rather than MailHog, which has had no meaningful release since
2020. Two things make it worth running by hand: the web UI is where you *look*
at a quote email, which is a visual artifact a string assertion cannot judge, and
its HTML-check report is what caught `max-width` being unsupported in Outlook
2007–2016. Note that report scores *properties*, so it still flags `max-width`
despite the ghost table that fixes it — don't chase the number.

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

The rotation splits the same way: `src/lib/roster.ts` is client-safe
(`RosterMember`, `moveItem`, `reorder`) and `src/lib/directory-schema.ts` holds
the client-safe `DirectoryPerson`, while `src/lib/rotation.ts` is the
`server-only` Mongo layer (and re-exports `roster.ts`). The editor imports
`DirectoryPerson` from `directory-schema.ts`, never from `ldap.ts` — pulling
`ldap.ts` into a `"use client"` file would drag `ldapts` into the browser bundle.

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

### Quote engagement

Likes and comments are normalized into `quote_likes` and `quote_comments`.
`quote_likes` has a unique `{ quoteId, userId }` index and the API uses
idempotent PUT desired-state semantics; `quote_comments` stores `authorId` but
not a name snapshot, so reads resolve the current `users.displayName`. The quote
feed's aggregate resolves counts, the viewer's like, and a deterministic
latest-two comment preview in one database command per page rather than querying
per card. Full comments read oldest-first and end every sort in `_id`.

`src/lib/engagement-schema.ts` is client-safe; `src/lib/engagement.ts` owns the
Mongo documents and mutations. Comment writes require ownership in the database
layer as well as hiding controls in the UI. Quote deletion removes the quote and
then its engagement without a transaction because standalone Mongo and
mongodb-memory-server do not support one; cleanup also runs on a repeated delete,
so retrying can finish a partial infrastructure failure.

### The printable document, and mailing it

A quote can be downloaded as a standalone HTML page
(`GET /api/quotes/[id]/document`, public like every other GET) and mailed to the
team list (`POST /api/quotes/[id]/send`, a session and same-origin required).
Both render the same document from `src/lib/quote-document.ts`.

**HTML rather than PDF, because of bidi.** No JavaScript PDF library implements
the Unicode Bidirectional Algorithm — not pdfkit, not `@react-pdf/renderer`, and
`pdf-lib` has been unpublished-to since 2022. Laying a PDF out ourselves would
mean hand-rolling UAX #9 reordering, bracket mirroring and UAX #14 line breaking,
whose failure mode is silently scrambled Hebrew on any line that also contains
Latin or digits — which is most of them here. The browser that opens the file
does all of it correctly and for free. If a real `.pdf` is ever required, Typst
handles bidi natively; pdfkit + `bidi-js` is the pure-JS fallback.

Consequences worth keeping:

- **The document references nothing outside itself.** Heebo is inlined as base64
  in `src/lib/fonts/heebo-embedded.ts` — a variable font, so one file per subset
  covers every weight, with a `unicode-range` each or the browser picks whichever
  face was declared last and loses a script. Base64 rather than a file read
  precisely to avoid `outputFileTracingIncludes`, a `public/` entry and its
  matching Dockerfile `COPY`: three ways to work in dev and fail in the container.
  It is why `quote-document.ts` is `server-only` despite being pure.
- **The email body and the attachment are different documents.** The attachment
  opens in a browser, so it keeps the webfont and the print stylesheet. The body
  is rendered by a mail client — Outlook uses Word's engine — so it stays on
  system fonts and inline styles, and is wrapped in an MSO "ghost table" because
  Word ignores `max-width` outright and the column would otherwise stretch to the
  full window.
- **Print backgrounds default to off**, so the page carries on type, rules and
  whitespace, never a filled shape. Fixed-width blocks need `margin-inline: auto`
  (centring the flex item does not centre its children) and `overflow-wrap`, or a
  pasted URL runs off the sheet — where, unlike on screen, it cannot be scrolled
  to.
- **`src/lib/mail.ts` splits config faults from relay faults** the way `ldap.ts`
  does: `ConfigError` → 500 *misconfigured*, anything else → 503 *unavailable*.
  `MAIL_DRY_RUN` builds and logs without sending, which is the setting for a
  first send against production, where `MAIL_TO` is a whole team. Setting only
  one of `SMTP_USER`/`SMTP_PASSWORD` is refused rather than half-applied: SMTP
  auth always carries a username, so an API key alone would otherwise drop
  `auth` silently and the relay would reject a config that looks complete.
- **`SMTP_TLS_INSECURE` is the sibling of `LDAP_TLS_INSECURE`** and is accepted
  on the same air-gapped grounds — the connection stays encrypted, what it drops
  is authenticating the relay, which lets an active MITM harvest whatever
  `SMTP_PASSWORD` holds. It is *not* nodemailer's `ignoreTLS`, which would skip
  STARTTLS entirely and send the credential in clear text. On anything routable,
  `NODE_EXTRA_CA_CERTS` is the right answer instead. It is part of the pooled
  transport's cache key, or flipping it would keep using the old transport.
- **The document carries no script, not even an inline `onclick`.** It is also
  served as `text/html` from the app's own origin, so a document that had opted
  into script is one where a future missed escape runs first-party with the
  session cookie in reach — and `Content-Disposition: attachment` is not the
  guard it looks like, since "open in new tab" and iOS Safari both ignore it. A
  Windows mail gateway is also likelier to eat an `.html` attachment that has a
  handler in it, which would drop the printable file while the mail sailed
  through. The print stylesheet does the work and the keyboard does the rest, so
  the old print button is a hint now. The route sends a `default-src 'none'`
  CSP with `sandbox` on top as the net under the escaping — but only for the
  *served* copy: a saved file opens from `file://` with no CSP at all, which is
  why the rule is "no script", not "CSP".
- **The mail body converts newlines to `<br>`; everything else uses
  `pre-wrap`.** Quotes are typed into a textarea, so multi-line is the common
  case, and the body is the part almost every client actually shows. `white-space:
  pre-wrap` is not available there for the same reason `max-width` isn't —
  Word's engine ignores both. Escape *first*, then replace, or the `<br>` is
  escaped along with the text.
- **`Reply-To` is dropped unless it is a bare `local@domain`.** AD's `mail` is
  free text — a display-name leftover, an Exchange `smtp:` proxy prefix, a value
  with a newline in it. Nodemailer does not refuse those, it emits them:
  measured, `smtp:x@y` becomes `Reply-To: smtp:x@y;`, RFC 5322 group syntax with
  no members, and a bare display name vanishes silently. A strict relay may
  bounce the message over a header that could never have worked, so
  `replyAddress` drops it and the mail goes out with none — the state a
  rotation-only user is in anyway.
- **The card's menu hides on `(hover: hover)`, never on a breakpoint.** It is
  the only way to reach copy, download, share, edit and delete, and an iPad in
  landscape is `sm`-and-wider with no pointer to hover — under a width query it
  became an invisible 32px target that was still in the hit map. Tailwind v4
  already wraps `hover:`/`group-hover:` in the media query; it is the
  `opacity-0` that needs saying so explicitly.
- **The send dialog refuses to close while a send is in flight.** The in-flight
  lock is state in the dialog and the card unmounts it on close, so letting
  Escape through would throw the lock away mid-request and let a second copy go
  to the whole team — the exact thing the confirmation exists to prevent.
- **Sharing is not hidden from signed-out visitors.** Like the like button, the
  control stays visible and becomes a link to `/login?next=…`; the API's 401 is
  the boundary. The download needs no session at all.

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
