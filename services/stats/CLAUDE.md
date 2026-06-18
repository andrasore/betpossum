# CLAUDE.md — Stats Service (FastAPI)

Guidance for working in `services/stats`. See the root `CLAUDE.md` for repo-wide
rules and `ARCHITECTURE.md` for the system overview.

## Commands

This repo uses **pnpm** for orchestration; the service itself is Python in a
local `.venv`.

```bash
pnpm --filter @betting/stats run init    # create .venv + install (.[dev])
```

Typecheck, build, test, and schema:gen from the **repo root** (`pnpm typecheck`
/ `pnpm test` / `pnpm schema:gen`), never from this workspace — generated
bindings and Turbo caching assume the root run. Lint is ruff
(`ruff check` + `ruff format`); types are pyright strict.

## What this service owns

A read model built from settled bets. It owns one Postgres table,
`stats_settlements` (one row per settled bet), in its **own `stats` schema** of
the shared `betting` database — logically separate from Core's tables, which
live in the `core` schema (`DB_SCHEMA` selects it).

## Non-obvious conventions

- **The event is the only input.** Stats never reads Core's or Odds' tables; the
  durable `BetSettledEvent` carries everything (denormalized, incl. the player's
  display name). Don't add a cross-service DB read or HTTP call back to Core.
- **Durable + idempotent consumer.** `bets.settled` is a durable fanout; the
  queue `stats.bets.settled` is durable with manual ack (mirrors Core's
  `events.resolved`). Idempotency is the `ON CONFLICT (bet_id) DO NOTHING`
  upsert — redelivery of a settlement is a no-op.
- **Forward-only.** No backfill of pre-existing bets; the read model accrues
  from new settlements.
- **Signed cents.** `profit_cents` is +profit on a win, −stake on a loss, so a
  plain `SUM` is net P&L. Money crosses the HTTP boundary in **dollars**.
- **Cumulative ROI%**, bucketed by UTC day: each `/stats/me/pnl` point is
  cumulative net ÷ cumulative stake to date. The maths lives in `aggregate.py`
  (pure, no DB) so it is unit-tested directly.
- **Auth split.** `/stats/me/*` require a verified Keycloak token (the `sub`
  scopes the query); `/stats/leaderboard` is public.
