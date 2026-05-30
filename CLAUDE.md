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
