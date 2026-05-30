# CLAUDE.md — Core API (NestJS)

Guidance for working in `services/core`. See the root `CLAUDE.md` for repo-wide
rules and `ARCHITECTURE.md` for the system overview.

## Commands

This repo uses **pnpm**, not npm.

```bash
pnpm start:dev   # nest start --watch (local, outside docker)
```

Typecheck, build, and test from the **repo root** (`pnpm typecheck` /
`pnpm build` / `pnpm test`), never from this workspace — proto bindings and
Turbo caching assume the root run. Lint is Biome (`pnpm lint` / `pnpm lint:fix`).

## What this service owns

The primary application service. It owns the Postgres schema (users, bets,
events, current odds) and — via the in-process `wallet` module — the
TigerBeetle ledger. Money never moves over the broker; `bets` calls `wallet`
through direct method calls.

## Module map (`src/`)

- `bets/` — placement and settlement. Subscribes to `events.resolved`.
- `wallet/` — TigerBeetle ledger. In-process Nest module, **not** a service.
- `messaging/` — the RabbitMQ wrapper (`publish` / `subscribe`).
- `notifications/` — `NotificationsClient`, publishes `NotificationEvent`s.
- `keycloak/` — JWT strategy + service-account lookups for user email/name.
- `admin/`, `users/`, `common/` — admin endpoints, user records, guards.
- `generated/` — protobuf output; **do not edit by hand** (`pnpm build`
  regenerates it from `/proto`).

## Non-obvious conventions

- **Bet settlement semantics.** `bet.payout` is *profit only*
  (`stake * (odds - 1)`), not total return. Win = `wallet.release()` (stake
  back) **+** `wallet.payout(profit)`; loss = `wallet.keep()` (stake to house).
  `settle()` throws unless the bet is in `held` state.
- **`events.resolved` is durable + exactly-once.** It's subscribed with
  `{ durable: true, queueName: "core.events.resolved" }`, manual ack, and a
  `status: 'held'` filter that makes the consumer idempotent. Other channels
  stay fire-and-forget (non-durable, anonymous auto-delete queue, `noAck`).
  Don't make a channel durable unless it's a state transition that must not be
  dropped.
- **Cents at the ledger boundary.** Dollars in the API/DTOs; convert to integer
  cents (`Math.round(x * 100)`) before any `wallet` call. TigerBeetle stores
  integer amounts only.
- `synchronize: true` is on (TypeORM) — fine for this demo; production would use
  migrations.
- Reach for the service that owns the data: features go where the data lives,
  not behind a core proxy. Core is not an API gateway.
