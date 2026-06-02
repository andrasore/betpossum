# CLAUDE.md

## Package manager: pnpm only

This repo uses **pnpm**, not npm. Never run `npm` commands — use `pnpm`
instead. The version is pinned via the `packageManager` field and the
`engines.pnpm` constraint in the root `package.json`.

## Build and typecheck

Always run typechecks and builds from the **repo root**, never from a single
workspace:

```bash
pnpm build      # builds all services (regenerates generated bindings)
pnpm typecheck  # typechecks all services
pnpm test       # runs all service tests
```

Do not run module-scoped checks (e.g. `cd services/core && npx tsc --noEmit`).
Generated schema bindings, cross-workspace imports, and Turbo's caching all
assume the root-level run; module-only checks can pass while the integrated
build fails. Run the full set every time, even if the change appears to touch
one module only.

## Git workflow

Commit and push **directly to `main`** — this is a sole-contributor repo, so do
not create feature branches or open PRs for changes. When asked to commit, commit
on `main` and push.

## Git hooks

The only hook is `.githooks/pre-push` (typecheck, lint, test, e2e, schema
guard); `hooks:setup` just points `core.hooksPath` at `.githooks/`. Expensive
checks belong at push time — **don't add a pre-commit hook**, even for a "fast"
check.

## Docker Compose

`docker-compose.yml` is the **local dev** stack. Variants activate explicitly
via `-f` against named overlays — `docker-compose.dev.yml`, `.ci.yml`,
`.e2e.yml`. Don't create a bare `docker-compose.override.yml`: compose
auto-loads that, and overlay activation must stay explicit. Host port mappings
stay **unprivileged** (≥1024) so `docker compose up` needs no root — e.g. nginx
is published on 8080, never 80 (the container-side port can still be 80).

## Dev workflow

The frontend runs **locally** via `pnpm dev` in `frontend/` (hot reload on
3000). The backend services (core, odds, notifications, nginx, keycloak) run in
Docker from built images and do **not** hot-reload. After changing a backend
service its container is stale until rebuilt — confirm before running
`docker compose up -d --build <service>`. The user does not iterate on the
dockerised frontend image.

## Tests and the Turbo cache

A Turbo cache hit (`>>> FULL TURBO`, `Cached: N cached`) means the task already
passed for the current inputs — trust it, don't `--force` just to re-see output.
To re-run something, change the source and Turbo invalidates automatically.
Don't write tests where every collaborator is mocked and the assertions just
echo the mock setup — that verifies the mocks, not the code. A test earns its
place only by exercising a real boundary (a guard, a DB constraint, a
serialization round-trip, an algorithm).

## Folder guides

Most important folders carry their own `CLAUDE.md` with folder-local
conventions. Read the relevant one before working in it; `ARCHITECTURE.md` has
the system overview.

| Folder | What it covers |
|--------|----------------|
| [`frontend/`](frontend/CLAUDE.md) | Next.js static-export SPA, OIDC+PKCE auth, runtime config |
| [`services/core/`](services/core/CLAUDE.md) | NestJS API: bets, wallet/ledger, settlement semantics, durable channels |
| [`services/odds/`](services/odds/CLAUDE.md) | FastAPI ingestion: pluggable provider/storage/publisher, co-located deps |
| [`services/notifications/`](services/notifications/CLAUDE.md) | Stateless socket.io relay; JSON-on-the-wire |
| [`schemas/`](schemas/CLAUDE.md) | Shared JSON Schema message contracts; regenerate-from-root workflow |
| [`nginx/`](nginx/CLAUDE.md) | Single-origin edge proxy; runtime `config.js` |
| [`e2e/`](e2e/CLAUDE.md) | Playwright full-stack tests; boot/teardown |
| [`keycloak/`](keycloak/CLAUDE.md) | Realm definitions, roles, clients |
