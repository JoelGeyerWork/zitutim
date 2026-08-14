@AGENTS.md

# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A team quote wall — who said something, when, and what led to it. Hebrew-native
and RTL throughout; all user-facing strings are Hebrew. Four pages: `/` (feed),
`/search`, `/create`, `/login`.

Public read, login to write: anyone who can reach the app can browse and search,
but adding, editing and deleting need a session. Sign-in binds against the
organisation's Active Directory over LDAP.

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

Auth mirrors the same split, with the same consequence — `ldapts` and `jose` in
the browser bundle:

| Module | Marker | Who may import |
|---|---|---|
| `src/lib/auth-schema.ts` | none — **client-safe** | client + server |
| `src/lib/session.ts` | `server-only`, re-exports the schema | server |
| `src/lib/ldap.ts` | `server-only` | server |
| `src/lib/users.ts` | `server-only`, re-exports the schema | server |
| `src/lib/login-throttle.ts` | `server-only` | server |

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
  Formatting it in local time shifts the day backwards west of Greenwich.
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
