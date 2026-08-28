# CLAUDE.md — Stats Service (NestJS)

Guidance for working in `services/stats`. See the root `CLAUDE.md` for repo-wide
rules and `ARCHITECTURE.md` for the system overview.

## Commands

```bash
pnpm --filter @betting/stats run start:dev   # nest start --watch
```

Typecheck, build, test and `schema:gen` from the **repo root** (`pnpm typecheck`
/ `pnpm build` / `pnpm test` / `pnpm schema:gen`), never from this workspace —
generated bindings and Turbo caching assume the root run. Lint is Biome.

`test` **needs a running Docker daemon**: the storage tests spin up a real
Postgres via `@testcontainers/postgresql` and drive the actual `PostgresStorage`
rather than a mock.

## What this service owns

A read model built from settled bets. It owns one Postgres table,
`stats_settlements` (one row per settled bet), in its **own `stats` schema** of
the shared `betting` database — logically separate from Core's tables, which
live in the `core` schema (`DB_SCHEMA` selects it).

## Storage abstraction

Persistence is pluggable, mirroring odds' `storage/`: the `StatsStorage`
abstract class in `storage/stats-storage.ts` (which doubles as the DI token),
the `PostgresStorage` implementation in `storage/postgres.storage.ts`, and the
`STATS_STORAGE` factory in `storage/storage.module.ts` (default `postgres`).
New backend = new `StatsStorage` subclass wired through the factory. Nest's
container is what gives the HTTP layer and the consumer one shared instance.

## Non-obvious conventions

- **The event is the only input.** Stats never reads Core's or Odds' tables; the
  durable `BetSettledEvent` carries everything (denormalized, incl. the player's
  display name). Don't add a cross-service DB read or HTTP call back to Core.
- **Durable + idempotent consumer.** `bets.settled` is a durable fanout; the
  queue `stats.bets.settled` is durable with manual ack and prefetch 16 (mirrors
  Core's `events.resolved`). Idempotency is `.orIgnore()` — `ON CONFLICT
  (bet_id) DO NOTHING` — so redelivery of a settlement is a no-op and a stale
  replay can never overwrite a row. A handler throw becomes nack+requeue; there
  is no DLX and no retry cap, same as Core's durable consumer.
- **Forward-only.** No backfill of pre-existing bets; the read model accrues
  from new settlements.
- **Signed cents.** `profitCents` is +profit on a win, −stake on a loss, so a
  plain `SUM` is net P&L. Money is **integer cents** on the way in and on the
  way out — the event carries cents, the columns store cents, and the HTTP
  responses return `*Cents` fields. Nothing here rounds; that is what keeps the
  read model identical to Core's ledger. Only ROI/win-rate percentages are
  floats.
- **`round2`, not `Math.round`.** The percentages have always been Python
  `round(x, 2)` values: ties break to **even**, and the decision is made on the
  double's exact value rather than on `x * 100`. `common/round.ts` reproduces
  both; using `Math.round` would shift published numbers.
- **`bigint` columns carry a numeric transformer.** TypeORM hands `bigint` back
  as a string, and without the transformer every cents sum would silently become
  string concatenation.
- **Cumulative ROI%**, bucketed by UTC day: each `/stats/me/pnl` point is
  cumulative net ÷ cumulative stake to date. The maths lives in
  `stats/aggregate.ts` (pure, no DB, no Nest) so it is unit-tested directly.
  A zero-profit settlement is **not** a win for win-rate.
- **The leaderboard aggregates in process, on purpose.** ROI is rounded to 2dp
  *before* ranking and the sort is stable, so rounded ties keep insertion order.
  A SQL `GROUP BY ... ORDER BY roi DESC` would rank on the unrounded value and
  could reorder ties.
- **Auth split.** `/stats/me/*` require a verified Keycloak token (the `sub`
  scopes the query); `/stats/leaderboard` and `/health` are `@Public()`.
