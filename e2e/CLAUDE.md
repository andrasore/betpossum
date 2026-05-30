# CLAUDE.md — End-to-end tests (Playwright)

`/e2e` boots the full stack in Docker and drives it through the browser against
the real nginx origin. Workspace `@betting/e2e`.

## Commands

```bash
pnpm e2e             # from repo root: playwright test (boots + tears down the stack)
pnpm --filter @betting/e2e run e2e:headed   # headed
```

`E2E_KEEP_STACK=1` leaves the stack up after the run for debugging.

## How it works

- `global-setup.ts` runs `compose up -d --build --wait`, then polls the
  Keycloak discovery URL and the frontend until both answer (`waitFor`).
- `global-teardown.ts` always captures per-service docker logs to
  `test-results/docker-logs`, then runs `compose down --volumes`.
- `compose.ts` defines the compose file stack and project name. The base stack
  is `docker-compose.yml` + `docker-compose.e2e.yml`, plus
  `docker-compose.ci.yml` when `CI` is set.

## Non-obvious conventions

- **Never pre-`down` before running e2e.** `global-teardown` already does
  `compose down --volumes`; don't prefix the command with a manual clean — it
  races setup and wastes time.
- **The e2e stack uses the 18xxx ports** (frontend 18080, Keycloak 18090) so it
  doesn't collide with a running dev stack (8080/8090). Same images, different
  rendered `config.js`.
- Tests hit the single nginx origin, exactly like a browser — no service is
  addressed directly.
- If a run fails, the docker logs under `test-results/docker-logs` are the first
  place to look; they're captured even on setup failure.
