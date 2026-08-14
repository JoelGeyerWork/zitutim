# ציטוטים · zitutim

A team quote wall — who said it, when, and what led to it. Hebrew-native, RTL
throughout, in red / white / black.

| Route     | What it is                                                        |
| --------- | ----------------------------------------------------------------- |
| `/`       | **פיד** — a scrolling social-style feed, newest first, infinite scroll |
| `/search` | **חיפוש** — debounced search across text, author and context, with sorting |
| `/create` | **ציטוט חדש** — the add form, plus everything you added this sitting |
| `/login`  | **כניסה** — sign in against Active Directory                        |

Editing and deleting live in the `⋯` menu on any card.

**Public read, login to write.** Browsing and searching are open to anyone who
can reach the app; adding, editing and deleting need a session. Sign-in binds
against the organisation's Active Directory over LDAP — the app keeps no
passwords of its own. Any signed-in user may edit or delete any quote; edits are
recorded in `updatedBy` rather than restricted.

## Stack

Next.js 16 (App Router) · React 19 · TypeScript · Tailwind CSS v4 ·
shadcn/ui (Base UI, generated in RTL mode) · MongoDB · Zod · ldapts · jose

## Getting started

Requires Node 20+ and Docker.

```bash
cp .env.example .env.local
npm install
npm run db:up          # MongoDB on localhost:27017
npm run db:seed:demo   # indexes + a few sample quotes
npm run dev
```

Then open http://localhost:3000.

Use `npm run db:seed` instead of `db:seed:demo` if you want the indexes without
the sample data. Seeding demo data is a no-op once the collection is non-empty.

### Scripts

| Script                 | Does                                        |
| ---------------------- | ------------------------------------------- |
| `npm run dev`          | Dev server                                  |
| `npm run build`        | Production build                            |
| `npm run start`        | Serve the production build                  |
| `npm run lint`         | ESLint                                      |
| `npm test`             | The whole test suite                        |
| `npm run test:watch`   | Vitest in watch mode                        |
| `npm run test:server`  | Server suite only                           |
| `npm run test:ui`      | Component suite only                        |
| `npm run db:up`        | Start MongoDB in Docker                     |
| `npm run db:down`      | Stop it (the `mongo-data` volume persists)  |
| `npm run db:seed`      | Create indexes                              |
| `npm run db:seed:demo` | Indexes + sample quotes, if the DB is empty |
| `npm run ldap:up`      | Start a local OpenLDAP for auth testing     |
| `npm run ldap:down`    | Stop it and drop its volumes                |
| `npm run test:ldap`    | Integration tests against that server       |

## Environment

| Variable              | Default   | Notes                                                                   |
| --------------------- | --------- | ----------------------------------------------------------------------- |
| `MONGODB_URI`         | —         | Required. `mongodb://localhost:27017` locally                            |
| `MONGODB_DB`          | `zitutim` | Database name                                                            |
| `SESSION_SECRET`      | —         | Required, 32+ chars. `openssl rand -base64 32`                           |
| `SESSION_TTL_HOURS`   | `8`       | How long a login stays valid                                             |
| `LDAP_URL`            | —         | Must be `ldaps://` unless `LDAP_STARTTLS=true`                           |
| `LDAP_STARTTLS`       | `false`   | Upgrade a plain `ldap://` connection instead of using `ldaps://`         |
| `LDAP_BASE_DN`        | —         | Where to search for user accounts                                        |
| `LDAP_BIND_DN`        | —         | Read-only service account, **not** a Domain Admin                        |
| `LDAP_BIND_PASSWORD`  | —         | Required; an empty value would bind anonymously and break every login    |
| `LDAP_TLS_CA`         | —         | PEM for the enterprise root CA, if the DC's cert isn't publicly trusted   |
| `LDAP_TLS_INSECURE`   | `false`   | Skip certificate verification (still encrypted; see the note below)      |
| `LDAP_USER_FILTER`    | `(&(objectCategory=person)(objectClass=user))` | Narrows the search to user objects |
| `LDAP_LOGIN_ATTRS`    | `sAMAccountName,userPrincipalName` | Attributes a typed username may match           |
| `LDAP_ID_ATTR`        | `objectGUID` | The immutable per-user identifier                                     |
| `LOGIN_TRUSTED_PROXY` | `false`   | Set only behind a proxy that overwrites `X-Forwarded-For`                |

The last three default to Active Directory's spelling and only need changing to
run against a different directory — an OpenLDAP container for local testing
would want `(objectClass=inetOrgPerson)`, `uid,mail` and `entryUUID`.
`LDAP_ID_ATTR` must name something **immutable**: everything a user adds hangs
off it, and directories reissue usernames. `objectGUID` is the only value read
as binary; anything else is taken as a string.

To point at Atlas instead of Docker, swap `MONGODB_URI` for the Atlas
connection string — nothing else changes.

A few things worth knowing before you deploy this:

- **`ldaps://` is not optional.** A simple bind sends the password in cleartext,
  so plain `ldap://` puts every employee's Windows password on the wire.
- **`LDAP_TLS_INSECURE=true` skips certificate verification.** The connection is
  still encrypted, so passive sniffing stays off the table; what it gives up is
  proving the server is really your DC, which lets an active MITM on the same
  network harvest domain passwords. It exists because this deployment is
  air-gapped. On anything routable, point `LDAP_TLS_CA` at your internal root
  (or use `NODE_EXTRA_CA_CERTS`) rather than reaching for it.
- **The service account's own password expiring breaks login for everyone.** Give
  it "password never expires", or monitor it.
- Without a reachable domain controller the app still runs fine — sign-in just
  reports the directory as unavailable, distinctly from a wrong password.

## API

`Quote` fields: `id`, `text`, `author`, `saidAt`, `context`, `addedBy`,
`addedById`, `updatedBy`, `updatedById`, `createdAt`, `updatedAt`. Dates are ISO
strings; `saidAt` is stored at UTC midnight and formatted in UTC so the day never
drifts across timezones. `addedBy` is a display-name snapshot taken from the
session at create time, `addedById` the reference into `users`; neither can be
set by the client, and neither is rewritten when someone else edits the quote.

| Method   | Path                | Notes                                                            |
| -------- | ------------------- | ---------------------------------------------------------------- |
| `GET`    | `/api/quotes`       | Public. `?q=` search, `?sort=added\|recent\|oldest\|author`, `?skip=`, `?limit=` (max 100) |
| `POST`   | `/api/quotes`       | Create. Needs a session                                            |
| `GET`    | `/api/quotes/:id`   | Public. Single quote, or `404`                                     |
| `PUT`    | `/api/quotes/:id`   | Replace. Needs a session                                           |
| `DELETE` | `/api/quotes/:id`   | `204`, or `404` if already gone. Needs a session                   |
| `POST`   | `/api/auth/login`   | `{ username, password }` → sets the session cookie, returns `{ user }` |
| `POST`   | `/api/auth/logout`  | `204`, clears the cookie. POST so an `<img>` tag can't trigger it   |

List responses are `{ quotes, total, hasMore }`.

Error responses are `{ error }` in Hebrew, plus `issues` keyed by field on a 422:

| Status | When                                                                    |
| ------ | ----------------------------------------------------------------------- |
| `400`  | Malformed JSON body                                                      |
| `401`  | Mutation without a session, or bad credentials on login                  |
| `403`  | `Origin` header from another site (CSRF guard)                           |
| `404`  | No such quote                                                            |
| `422`  | Validation failed — `issues` is `{ field: message }`                     |
| `429`  | Login throttled; `Retry-After` says for how long                         |
| `503`  | The directory is unreachable — deliberately distinct from bad credentials |

The `401` is returned **before** the body is parsed, so an anonymous caller can't
use the validation behaviour to probe the schema.

## Tests

```bash
npm test
```

Vitest, split into two projects (`vitest.config.mts`):

| Project  | Environment | Covers                                                    |
| -------- | ----------- | --------------------------------------------------------- |
| `server` | node        | Zod validation, date/Hebrew formatting, the Mongo data layer, sessions, the LDAP client, login throttling, the API route handlers |
| `ui`     | jsdom       | `QuoteCard`, `QuoteForm`, `QuoteSearch`, `QuoteFeed`, `SiteNav`, `LoginForm`, `AccountMenu` via Testing Library |

In `npm test` the LDAP client is driven through a fake `ldapts` `Client`, so no
server or network is involved there either.

### Testing auth against a real directory

There is also a third project, deliberately outside `npm test`:

```bash
npm run ldap:up     # OpenLDAP on :1636, seeded from ldap/bootstrap/
npm run test:ldap
npm run ldap:down
```

It runs the real `authenticate()` over real LDAPS — real BER encoding, a real
TLS handshake, a real bind — covering the two-bind flow, RFC 4515 filter
escaping, the empty-password guard, and identity mapping. With nothing
listening, every test skips rather than fails.

This is plain OpenLDAP, not Active Directory, so it is configured through the
same `LDAP_*` variables the app ships with (`inetOrgPerson`, `uid,mail`,
`entryUUID`). It cannot reproduce `objectGUID` byte order or AD's error
sub-codes; those stay covered by the unit tests, and by testing against your own
domain controller before you deploy.

`ldap:up` generates a self-signed certificate into `.ldap/certs/` first. That
isn't a way around certificate checking — it's the same shape as production,
where the DC presents an internal-CA certificate and `LDAP_TLS_CA` trusts it.
Two things about `osixia/openldap:1.5.0` worth knowing if you poke at it
directly: the certificate baked into the image expired in January 2026, and it
demands a client certificate unless told otherwise. The compose file handles
both.

The server suite runs against a real MongoDB — `mongodb-memory-server` starts a
throwaway instance per run, so `npm test` needs no Docker and touches nothing in
your dev database. (The first run downloads a Mongo binary and caches it.)
Route handlers are called directly with `Request` objects rather than over HTTP,
so no server has to be running.

A few environment quirks are handled in `tests/setup/`:

- `server-only` throws unless it is imported under Next's react-server
  condition, so it is aliased to a stub.
- Node 26 defines its own `localStorage` global that stays `undefined` without
  `--localstorage-file`, and it shadows jsdom's. The UI setup substitutes a
  working in-memory `Storage`.
- jsdom has no `matchMedia`, which `next-themes` calls on mount.
- The server setup supplies `SESSION_SECRET` and the `LDAP_*` vars. Every one of
  those is read lazily by the app, which is what lets the setup file fill them in
  after imports have already run.

## Notes on the code

- **`src/lib/quote-schema.ts` vs `src/lib/quotes.ts`.** The schema module holds
  the types, constants and Zod validation, and imports nothing from `mongodb` —
  that's what client components are allowed to touch. `quotes.ts` is the data
  layer and is marked `server-only`.
- **Validation runs on the server.** The form does a fast required-fields check
  for responsiveness, but the API re-validates everything with the same Zod
  schema and returns field-keyed errors the form renders inline.
- **Search is a case-insensitive regex** with user input escaped, over text,
  author, context and addedBy. If the wall ever grows past a few thousand
  quotes, swap it for a MongoDB text index.
- **Pagination is offset-based** (`skip`/`limit`), which is plenty at this size
  and keeps "load more" simple on both the feed and search.
- **Light and dark** share one red / white / black palette, driven by
  `next-themes` with a picker in the header. `globals.css` pins `color-scheme` to
  whichever is resolved so native controls (the date picker especially) follow
  the site rather than the OS.
- **Authentication is a direct LDAP bind.** Two binds per login: once as a
  read-only service account to find the user's DN, then again as that DN with
  their password. Binding against the DN the directory returned — rather than one
  built from user input — is what keeps the flow free of DN-escaping problems.
- **Sessions are a stateless signed JWT** in an httpOnly cookie carrying only an
  id, display name and username. The trade-off is that a disabled AD account
  stays valid until the token expires (8 hours by default).
- **Login is throttled below the AD lockout threshold.** Every failed bind
  increments a real `badPwdCount`, so without a limit in front of it anyone could
  lock the whole company out of Windows by iterating usernames. The budget is
  keyed on the directory id the search resolves to — not on what was typed — so
  signing in by username and by email share one allowance, and it is spent
  atomically before the bind so concurrent attempts can't all slip through.
