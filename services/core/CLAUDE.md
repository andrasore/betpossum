# CLAUDE.md — Core API (NestJS)

Guidance for working in `services/core`. See the root `CLAUDE.md` for repo-wide
rules and `ARCHITECTURE.md` for the system overview.

## Commands

This repo uses **pnpm**, not npm.

```bash
pnpm start:dev   # nest start --watch (local, outside docker)
```

Typecheck, build, and test from the **repo root** (`pnpm typecheck` /
`pnpm build` / `pnpm test`), never from this workspace — generated bindings and
Turbo caching assume the root run. Lint is Biome (`pnpm lint` / `pnpm lint:fix`).

## What this service owns

The primary application service. It owns the Postgres schema (users, bets,
events, current odds) and — via the in-process `wallet` module — the
TigerBeetle ledger. Money never moves over the broker; `bets` calls `wallet`
through direct method calls.

## Module map (`src/`)

- `bets/` — placement and settlement. Subscribes to `events.resolved`.
- `odds/` — `OddsCacheService`, the local replica of the current line that
  `bets` prices placements from. Read-only; core never writes odds.
- `wallet/` — TigerBeetle ledger. In-process Nest module, **not** a service.
- `messaging/` — the RabbitMQ wrapper (`publish` / `subscribe`).
- `notifications/` — `NotificationsClient`, publishes `NotificationEvent`s.
- `keycloak/` — JWT strategy + service-account lookups for user email/name.
- `admin/`, `users/`, `common/` — admin endpoints, user records, guards.
- `generated/` — Zod schemas generated from `/schemas`; **do not edit by hand**
  (`pnpm schema:gen` regenerates it).

## Non-obvious conventions

- **The client never names a price.** `PlaceBetDto` has no `odds` field.
  `place()` reads `OddsCacheService.priceFor(eventId, selection)` and stamps
  that onto the bet; a null (unknown or resolved event, cache past
  `ODDS_MAX_AGE_MS`, or a market the event doesn't offer — the feed's `0`) is a
  409, never a fallback to something the caller supplied. `MIN_ODDS`/`MAX_ODDS`
  moved out of the DTO and onto `priceFor`, which is now the only door a price
  comes through. Settlement still reads the *stamped* odds off the bet row, so a
  bet always pays at the price it was accepted at, not the price at resolution.
- **Odds reach core by message; the HTTP hydrate is boot-only.**
  `OddsCacheService` is fed by the `odds.updated` fanout (fire-and-forget, like
  every other odds channel) and warmed once at startup by `GET
  {ODDS_SERVICE_URL}/odds/events`. That call is deliberately *outside* any
  request — it retries with backoff and degrades to "no bets until the first
  tick" rather than failing boot. Do **not** move an odds lookup into the
  request path; the whole module exists to keep it out. See "Service
  boundaries" in `ARCHITECTURE.md`.
- **`ODDS_MAX_AGE_MS` must exceed the odds service's `POLL_INTERVAL_SECONDS`.**
  Staleness is measured against the feed's own `updatedAt`, so a bound tighter
  than the poll interval marks every merely-un-refreshed price stale and closes
  betting entirely.
- **Bet settlement semantics.** `bet.payoutCents` is *profit only*
  (`stakeCents * (odds - 1)`), not total return. Win = `wallet.release()` (stake
  back) **+** `wallet.payout(profit)`; loss = `wallet.keep()` (stake to house).
  `settle()` throws unless the bet is in `held` state.
- **`events.resolved` is durable + exactly-once.** It's subscribed with
  `{ durable: true, queueName: "core.events.resolved" }`, manual ack, and a
  `status: 'held'` filter that makes the consumer idempotent. Other channels
  stay fire-and-forget (non-durable, anonymous auto-delete queue, `noAck`).
  Don't make a channel durable unless it's a state transition that must not be
  dropped.
- **Integer cents everywhere.** Money is a whole number of cents in the DTOs,
  the `bets` columns, the wire contracts, and the ledger — never a float dollar
  amount, and always named `*Cents`. Dollars exist only as a display/input
  string in the browser. `odds` is a ratio, not money, so it stays a decimal.
  The one place a money value is rounded is `profitCents()` in `common/money.ts`
  (half-up), because `stakeCents * (odds - 1)` is genuinely fractional; don't
  add a second rounding site.
- `synchronize: true` is on (TypeORM) — fine for this demo; production would use
  migrations.
- Reach for the service that owns the data: features go where the data lives,
  not behind a core proxy. Core is not an API gateway. The ban is on serving a
  request by calling a sibling — not on ever talking to one. Out-of-band work
  (the boot-time odds hydrate above; a background refresh) is fine, because a
  sibling being down delays a cache instead of failing a user's request. If you
  find yourself wanting a sibling's data *during* a request, replicate it
  locally off its event stream the way `odds/` does.
