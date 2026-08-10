# ציטוטים · zitutim

A team quote wall — who said it, when, and what led to it. Hebrew-native, RTL
throughout, in red / white / black.

Three pages:

| Route     | What it is                                                        |
| --------- | ----------------------------------------------------------------- |
| `/`       | **פיד** — a scrolling social-style feed, newest first, infinite scroll |
| `/search` | **חיפוש** — debounced search across text, author and context, with sorting |
| `/create` | **ציטוט חדש** — the add form, plus everything you added this sitting |

Editing and deleting live in the `⋯` menu on any card, on all three pages.

## Stack

Next.js 16 (App Router) · React 19 · TypeScript · Tailwind CSS v4 ·
shadcn/ui (Base UI, generated in RTL mode) · MongoDB · Zod

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
| `npm run app:up`       | Build and run app + MongoDB in Docker       |
| `npm run app:down`     | Stop the whole stack                        |

## Environment

| Variable      | Default    | Notes                                        |
| ------------- | ---------- | -------------------------------------------- |
| `MONGODB_URI` | —          | Required. `mongodb://localhost:27017` locally |
| `MONGODB_DB`  | `zitutim`  | Database name                                 |

To point at Atlas instead of Docker, swap `MONGODB_URI` for the Atlas
connection string — nothing else changes.

## Docker

`Dockerfile` builds a production image from Next.js' `standalone` output — the
runtime stage is `node:22-alpine` plus `server.js`, the traced subset of
`node_modules` and the static assets, running as an unprivileged `nextjs` user.

```bash
npm run app:up     # app on http://localhost:3000, Mongo on :27017
npm run app:down
```

The app is a compose profile, so `npm run db:up` still starts Mongo on its own
for the normal `npm run dev` loop. Tear the stack down with `app:down` rather
than `db:down` — `db:down` carries no profile either, so it would stop Mongo and
leave the app container running.

Compose does not read `.env.local`, so the app service sets `MONGODB_URI` and
`MONGODB_DB` itself: inside the network Mongo is `mongodb://mongo:27017`, not
the `localhost` the host tooling uses, and the database is always `zitutim`.
Mongo is still published on `27017`, so `npm run db:seed:demo` seeds what the
container reads — as long as `MONGODB_DB` in your `.env.local` is the default
`zitutim`. If you change it there, change it in `docker-compose.yml` too, or the
two will point at different databases.

The image needs no database at build time — every page that reads Mongo is
`force-dynamic`.

## API

`Quote` fields: `id`, `text`, `author`, `saidAt`, `context`, `addedBy`,
`createdAt`, `updatedAt`. Dates are ISO strings; `saidAt` is stored at UTC
midnight and formatted in UTC so the day never drifts across timezones.

| Method   | Path               | Notes                                                            |
| -------- | ------------------ | ---------------------------------------------------------------- |
| `GET`    | `/api/quotes`      | `?q=` search, `?sort=added\|recent\|oldest\|author`, `?skip=`, `?limit=` (max 100) |
| `POST`   | `/api/quotes`      | Create. `422` with per-field Hebrew messages when invalid          |
| `GET`    | `/api/quotes/:id`  | Single quote, or `404`                                             |
| `PUT`    | `/api/quotes/:id`  | Replace                                                            |
| `DELETE` | `/api/quotes/:id`  | `204`, or `404` if already gone                                    |

List responses are `{ quotes, total, hasMore }`.

## Tests

```bash
npm test
```

Vitest, split into two projects (`vitest.config.mts`):

| Project  | Environment | Covers                                                    |
| -------- | ----------- | --------------------------------------------------------- |
| `server` | node        | Zod validation, date/Hebrew formatting, the Mongo data layer, the API route handlers |
| `ui`     | jsdom       | `QuoteCard`, `QuoteForm`, `QuoteSearch`, `QuoteFeed`, `SiteNav` via Testing Library |

The server suite runs against a real MongoDB — `mongodb-memory-server` starts a
throwaway instance per run, so `npm test` needs no Docker and touches nothing in
your dev database. (The first run downloads a Mongo binary and caches it.)
Route handlers are called directly with `Request` objects rather than over HTTP,
so no server has to be running.

Two environment quirks are handled in `tests/setup/`:

- `server-only` throws unless it is imported under Next's react-server
  condition, so it is aliased to a stub.
- Node 26 defines its own `localStorage` global that stays `undefined` without
  `--localstorage-file`, and it shadows jsdom's. The UI setup substitutes a
  working in-memory `Storage`.

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
- **The palette is light-only** by design — `color-scheme: light` is pinned in
  `globals.css` so native controls (the date picker especially) match. Dark
  tokens are already defined under `.dark` if you ever want to opt in.
- **No auth.** Anyone who can reach the app can add, edit and delete quotes.
  `addedBy` is a free-text field remembered in `localStorage`, not an identity.
