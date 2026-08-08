@AGENTS.md

# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A team quote wall — who said something, when, and what led to it. Hebrew-native
and RTL throughout; all user-facing strings are Hebrew. Three pages: `/` (feed),
`/search`, `/create`.

## Commands

```bash
npm run db:up          # MongoDB in Docker on :27017 — needed before dev
npm run db:seed:demo   # indexes + sample quotes (no-op if the collection is non-empty)
npm run dev
npm run build
npm run lint
npx tsc --noEmit       # there is no typecheck script; build runs tsc too
```

`npm run db:seed` creates the indexes without the sample data. `npm run db:down`
stops Mongo but keeps the `mongo-data` volume.

Requires `.env.local` (`cp .env.example .env.local`). Both seed scripts read it
via `node --env-file`, so they fail without it.

### Tests

```bash
npm test                                          # both projects
npm run test:server                               # node project only
npm run test:ui                                   # jsdom project only
npm run test:watch
npx vitest run --project server tests/server/quotes.test.ts    # one file
npx vitest run --project ui -t "highlights the search term"    # one test by name
```

Tests need **no** Docker and no dev server: `mongodb-memory-server` starts a
throwaway Mongo per run, and route handlers are called directly with `Request`
objects. The first run downloads and caches a Mongo binary.

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

### Invariants worth not breaking

- **`saidAt` is stored at UTC midnight and formatted in UTC** (`src/lib/format.ts`).
  Formatting it in local time shifts the day backwards west of Greenwich.
- **Every entry in `sortSpecs` ends in `_id`.** Without a total order, offset
  pagination shows a quote twice or skips it when sort keys tie.
- **Search escapes regex metacharacters** before building the `RegExp`. `.*` must
  match the literal text, not everything. `Highlighted` in `quote-card.tsx` does
  the same escaping client-side.
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
- `<Button render={<Link/>}>` needs `nativeButton={false}`, or Base UI logs an error.
- `<SelectValue>` takes children as a *function* of the value; without it the raw
  value renders instead of the label.
- Check the installed `.d.ts` under `node_modules/@base-ui/react/` when unsure —
  the API differs from Radix-era shadcn docs.

Dialogs are driven by controlled `open` state from the parent and mounted only
while open (see `quote-card.tsx`), rather than nesting triggers inside menu items.

## Test environment quirks

All of these are already handled in `tests/setup/`; don't be surprised by them.

- `server-only` throws unless imported under Next's react-server condition, so
  `vitest.config.mts` aliases it to a stub.
- Node 26 defines its own `localStorage` global that stays `undefined` without
  `--localstorage-file` and shadows jsdom's. `tests/setup/dom.ts` substitutes a
  working in-memory `Storage`. `quote-form.tsx` also guards its reads in
  try/catch, since storage genuinely throws in Safari private browsing.
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
- No auth. `addedBy` is free text remembered in `localStorage`, not an identity —
  don't treat it as one.
