# CLAUDE.md — Odds Service (NestJS)

Guidance for working in `services/odds`. See the root `CLAUDE.md` and
`ARCHITECTURE.md` for context.

## Commands

```bash
pnpm --filter @betting/odds run start:dev   # nest start --watch
```

Typecheck, build, test and `schema:gen` from the **repo root** (`pnpm typecheck`
/ `pnpm build` / `pnpm test` / `pnpm schema:gen`), never from this workspace —
generated bindings and Turbo caching assume the root run. Lint is Biome.

`test` **needs a running Docker daemon**: the storage and controller tests spin
up a real Postgres via `@testcontainers/postgresql` and drive the actual
`PostgresStorage` rather than a mock. The pre-push hook runs `test`, so Docker
must be up to push.

## What this service does

Ingests odds from one or more external providers (each on its own poll loop),
normalises them into a provider-agnostic common model, persists current odds to
Postgres, and publishes `OddsUpdatedEvent` / `EventResolvedEvent` (JSON) to
RabbitMQ. Also serves the public `GET /odds/events` hydrate endpoint. It does
**not** calculate odds — ingestion + normalisation only.

### Common model & multi-provider

- `ODDS_PROVIDERS` is a comma-separated list. Every enabled provider runs
  concurrently; events are kept **separate per provider**, never merged.
- Providers transform their payloads into a `CanonicalEvent` (`odds/models.ts`):
  an event carries N `Market`s, each with N `Selection`s (`key`, `name`, `odds`,
  optional `point`). This represents many sports/bet types (h2h, totals, …)
  flexibly. Only the `h2h` market projects onto the 3-way wire contract via
  `h2hOdds()`; events without h2h are persisted but not emitted.
- Canonical id is `${origin}:${sourceEventId}`. `odds_current.origin` records
  the producing provider; the `event_source_map` table links the canonical id
  back to each provider's original ids.
- **Manual resolution is mock-only.** `POST /odds/events/:eventId/result`
  returns 409 unless the event's `origin === "mock"` (404 if unknown) —
  settlement stays single-sourced.
- **Real providers resolve themselves by polling.** A provider that can discover
  event conclusions sets `pollsResults = true` and implements
  `fetchResults(pending)`; the runner passes it that provider's
  kicked-off-but-unresolved events (`OddsStorage.listUnresolved`, bounded by the
  `RESULTS_*` constants in `runner/runner.service.ts`), so providers still never
  touch storage. `apifootball` and `theoddsapi` both do this; `mock` is resolved
  through the admin route instead. An event that ends with no fair outcome
  (cancelled, abandoned) is skipped rather than guessed at, so its bets stay
  held. The two real providers derive the outcome differently, because their
  APIs differ: API-Football has winner flags (`/fixtures?ids=`, up to 20 ids a
  request, and an AET/PEN fixture resolves to whoever *advanced*, not the
  90-minute score), while The Odds API has none, so `/scores` outcomes come from
  comparing the two string scores. `/scores` also caps `daysFrom` at 3, tighter
  than `RESULTS_LOOKBACK_MS` — a theoddsapi event unresolved for longer than
  that can no longer be resolved by polling.
- The wire schema (`OddsUpdatedEvent`/`EventResolvedEvent`) stays 3-way and
  **unchanged**; the flexible model lives entirely inside this service.

## Layout (`src/`)

- `main.ts` — `CREATE SCHEMA IF NOT EXISTS` (TypeORM won't) then Nest bootstrap.
- `runner/runner.service.ts` — the poll loop: `fetchTick` → `storage.record` →
  `publish`, then `fetchResults` → `storage.recordResult` → `publishResult`.
- `providers/` — pluggable `OddsProvider` (`base.ts`, `mock.provider.ts`,
  `theoddsapi.provider.ts`, `apifootball.provider.ts`; `common.ts` holds shared
  transform helpers); the enabled set is chosen by `ODDS_PROVIDERS`. Each yields
  `CanonicalEvent`s from an async generator.
- `storage/` — pluggable `OddsStorage` (`postgres.storage.ts`); selected by
  `ODDS_STORAGE`. TypeORM entities in `entities.ts` own the schema
  (`synchronize: true`); `markets` is a `jsonb` column so the flexible
  `Market`/`Selection` model round-trips without manual JSON.
- `publisher/odds.publisher.ts` — the three RabbitMQ exchanges.
- `odds/` — HTTP controller, wire mappers, domain models, the normalizer.
- `auth/` — Keycloak bearer verification for the admin route.
- `health/` — `GET /health`, the container healthcheck endpoint.

## Non-obvious conventions

- **Pluggable via env, abstract base.** New provider/storage = new subclass of
  the `base.ts` / `odds-storage.ts` abstract class, wired through the module
  factory (`getProvider` in `providers/providers.module.ts`, the `ODDS_STORAGE`
  switch in `storage/storage.module.ts`). Nest's container is what gives the
  HTTP layer and the runner one shared storage instance.
- **Route order matters.** `/odds/sports` and `/odds/leagues` must be declared
  *before* `/odds/:eventId` in the controller, or they are swallowed as event
  lookups and 404. Two specs guard exactly this.
- **DTOs must be value imports, never `import type`.** `import type` erases the
  class, so `emitDecoratorMetadata` loses the param type and `ValidationPipe`
  silently skips validation — an invalid `outcome` would 201 instead of 400.
  This is why `biome.jsonc` disables `useImportType`.
- **Optional fields serialise as `null`, never omitted.** `odds/mappers.ts`
  writes every optional key explicitly; `JSON.stringify` drops `undefined`, and
  the frontend's generated Zod schemas expect the key present.
- **The entity resolver's upserts are raw SQL on purpose.** The get-or-create
  idiom is `ON CONFLICT ... DO UPDATE ... RETURNING id` (only `DO UPDATE` makes
  `RETURNING` yield the *existing* row on conflict), and the country update is a
  `COALESCE` so a first-seen value is kept and only a missing one backfilled.
  TypeORM's `.orUpdate()` can express neither. Reads use the query builder.
  Because those statements use bare table names, `app.module.ts` also pins the
  session `search_path` alongside TypeORM's own `schema` option.
- **`CURRENT_UPDATE_COLS` excludes `outcome`/`resolved_at`.** A later odds tick
  must never un-resolve a settled event; a spec pins this.
- **The runner sleeps *after* each tick, not on a fixed rate.** `@nestjs/schedule`'s
  `@Interval()` is not equivalent and must not be substituted — it would let a
  slow tick overlap the next. The try/catch sits *inside* the loop so a failed
  tick logs and the worker keeps going.
- **The mock fixture ids are load-bearing.** `e2e/tests/{sport,league}-filter.spec.ts`
  assert on `mock:epl-*` / `mock:nba-*` / `mock:nfl-*` and on the Premier League
  / NBA / NFL chips.
- **Single instance.** The poll loops have no leader election, so a second
  replica would double-publish every odds update.
