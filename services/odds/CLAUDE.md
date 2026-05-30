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
```

There is **no `build` script** — `pnpm build` only runs TS workspaces. Don't add
a fake one. `schema:gen` regenerates `src/generated` (Pydantic models) from
`/schemas` (run by `pnpm schema:gen` at the root).

## What this service does

Ingests odds from an external provider on an asyncio poll loop, normalises them,
persists current odds to Postgres, and publishes `OddsUpdatedEvent` /
`EventResolvedEvent` (JSON) to RabbitMQ. Also serves the public `GET /odds` hydrate
endpoint. It does **not** calculate odds — ingestion + normalisation only.

## Layout (`src/`)

- `app.py` — FastAPI app + `lifespan`: opens storage/publisher and spawns the
  background `run()` worker; HTTP request-logging middleware; `/health`.
- `runner.py` — the poll loop: `fetch_tick` → `storage.record` → `publish`.
- `providers/` — pluggable `OddsProvider` (`base.py`, `mock.py`,
  `theoddsapi.py`); selected by `ODDS_PROVIDER` env.
- `storage/` — pluggable `OddsStorage` (`postgres.py`); selected by
  `ODDS_STORAGE`.
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
  at the call site — never a file-wide `# pyright: foo=false` pragma.
- `auth.py` uses FastAPI's `OAuth2AuthorizationCodeBearer` scheme so header
  parsing and Swagger's Authorize flow come for free; JWKS verification uses the
  internal Keycloak URL, the OAuth metadata uses the browser-facing issuer.
