# CLAUDE.md — Odds Service (FastAPI)

Guidance for working in `services/odds`. See the root `CLAUDE.md` and
`ARCHITECTURE.md` for context.

## Commands

Driven by pnpm scripts that wrap the venv; run from the **repo root** where
possible:

```bash
pnpm --filter @betting/odds run init      # create .venv, pip install -e .[dev]
pnpm --filter @betting/odds run typecheck  # pyright (strict)
pnpm --filter @betting/odds run lint        # ruff check + format --check
pnpm --filter @betting/odds run test        # pytest (test/ dir; asyncio auto-mode)
```

`test` **needs a running Docker daemon**: the storage tests spin up a real
Postgres via `testcontainers` (`postgres:16-alpine`, started once per session)
and drive the actual `PostgresStorage` rather than a mock. The pre-push hook
runs `test`, so Docker must be up to push.

There is **no `build` script** — `pnpm build` only runs TS workspaces. Don't add
a fake one. `schema:gen` regenerates `src/generated` (Pydantic models) from
`/schemas` (run by `pnpm schema:gen` at the root).

## What this service does

Ingests odds from one or more external providers (each on its own asyncio poll
loop), normalises them into a provider-agnostic common model, persists current
odds to Postgres, and publishes `OddsUpdatedEvent` / `EventResolvedEvent` (JSON)
to RabbitMQ. Also serves the public `GET /odds/events` hydrate endpoint. It does **not**
calculate odds — ingestion + normalisation only.

### Common model & multi-provider

- `ODDS_PROVIDERS` is a comma-separated list (legacy singular `ODDS_PROVIDER`
  still honoured). Every enabled provider runs concurrently; events are kept
  **separate per provider**, never merged.
- Providers transform their payloads into a `CanonicalEvent` (`odds/models.py`):
  an event carries N `Market`s, each with N `Selection`s (`key`, `name`, `odds`,
  optional `point`). This represents many sports/bet types (h2h, totals, …)
  flexibly. Only the `h2h` market projects onto the 3-way wire contract via
  `h2h_odds()`; events without h2h are persisted but not emitted.
- Canonical id is `f"{origin}:{source_event_id}"`. `odds_current.origin` records
  the producing provider; the `event_source_map` table links the canonical id
  back to each provider's original ids.
- **Manual resolution is mock-only.** `POST /odds/events/{id}/result` returns 409 unless
  the event's `origin == "mock"` (404 if unknown). Real-provider events are never
  auto-resolved — this keeps settlement single-sourced.
- The wire schema (`OddsUpdatedEvent`/`EventResolvedEvent`) stays 3-way and
  **unchanged**; the flexible model lives entirely inside this service.

## Layout (`src/`)

- `app.py` — FastAPI app + `lifespan`: opens storage/publisher and spawns the
  background `run()` worker; HTTP request-logging middleware; `/health`.
- `runner.py` — the poll loop: `fetch_tick` → `storage.record` → `publish`.
- `providers/` — pluggable `OddsProvider` (`base.py`, `mock.py`, `theoddsapi.py`,
  `apifootball.py`; `common.py` holds shared transform helpers); the enabled set
  is chosen by `ODDS_PROVIDERS`. Each yields `CanonicalEvent`s.
- `storage/` — pluggable `OddsStorage` (`postgres.py`); selected by
  `ODDS_STORAGE`. Persistence is **SQLModel** over an async SQLAlchemy engine
  (asyncpg driver). The `SQLModel` table classes live in `postgres.py` and own
  the schema (`init_schema` = `metadata.create_all`); `markets` is a `JSONB`
  column so the flexible `Market`/`Selection` model round-trips without manual
  JSON. Upserts use `postgresql.insert(...).on_conflict_do_update`.
- `publisher/` — RabbitMQ `OddsPublisher`.
- `odds/` — HTTP routes, Pydantic schemas, domain models.
- `auth.py` — Keycloak bearer verification for admin routes.

## Non-obvious conventions

- **Co-locate FastAPI deps.** Each package keeps its own `dependencies.py` with
  the provider + an `Annotated[..., Depends(...)]` alias (`StorageDep`,
  `PublisherDep`). Singletons are module globals opened/closed in `lifespan` —
  **not** `app.state`, and not a merged top-level deps module.
- **Pluggable via env, abstract base.** New provider/storage/publisher = new
  subclass of the `base.py` ABC, wired through the package's `__init__` factory
  (`get_provider` / `get_storage`). Keep `from_env` on the class.
- **Pyright is strict; use per-line ignores only.** `# pyright: ignore[rule]`
  at the call site — never a file-wide `# pyright: foo=false` pragma. SQLModel
  needs a couple: explicit `__tablename__` trips `reportAssignmentType`
  (SQLAlchemy types it as `declared_attr`), so the names carry per-line ignores.
- **SQLModel writes go through the engine connection, reads through a session.**
  `on_conflict_do_update` is a Core construct and SQLModel deprecates
  `AsyncSession.execute`, so `record`/`record_result` run their upserts on
  `engine.begin()`; only `select`-based reads use `session.exec`.
- **`storage/base.py` imports domain models under `TYPE_CHECKING` only.** A
  runtime import there forms a `storage → odds → routes → storage.dependencies`
  cycle; the ABC needs the names purely for annotations, so keep them guarded.
- `auth.py` uses FastAPI's `OAuth2AuthorizationCodeBearer` scheme so header
  parsing and Swagger's Authorize flow come for free; JWKS verification uses the
  internal Keycloak URL, the OAuth metadata uses the browser-facing issuer.
