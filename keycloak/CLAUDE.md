# CLAUDE.md — Identity (Keycloak)

`/keycloak` builds the Keycloak image and ships the realm definitions imported
at container start. Keycloak owns **all** authentication.

## Files

- `Dockerfile` — two-stage build off `quay.io/keycloak/keycloak:26.0`;
  `kc.sh build` with `KC_DB=postgres`, then `start --optimized --import-realm`.
- `realm.json` — the `betting` realm for dev.
- `realm.e2e.json` — realm variant for the e2e stack (different ports/URLs).

## Realm shape

- Realm `betting`, two roles: `admin` (gates admin pages/endpoints) and `user`
  (default for everyone).
- Two clients:
  - `betting-frontend` — **public**, PKCE; used by the SPA.
  - `betting-core` — **confidential**, service account; Core uses it to call the
    admin API for user email/name lookups.
- Keycloak runs against its **own `keycloak` database** (own role/credentials)
  on the shared Postgres instance, separate from the app's `betting` database.
  Infra's `postgres/init.sql` provisions it.

## Conventions

- **Realm config is import-only.** Edit the `realm*.json` files and let
  `--import-realm` apply them on boot; don't hand-tweak through the admin UI and
  expect it to persist — changes there are lost on the next clean boot.
- **`--import-realm` only imports a realm that does not already exist.** Once the
  `betting` realm is persisted in the `keycloak` database (now a database on the
  shared `postgres` container, no longer a dedicated volume), edits to
  `realm.json` (a new `loginTheme`, client, role, mapper…) are **silently
  ignored** on a plain `docker compose up -d keycloak`. To pick up dev realm
  changes, drop and recreate just the `keycloak` database, then re-import — this
  leaves the app's `betting` data intact (a full `down -v` would wipe both):
  ```bash
  docker compose stop keycloak
  docker compose exec -T postgres psql -U betting -c 'DROP DATABASE keycloak;'
  docker compose exec -T postgres psql -U betting \
    -c 'CREATE DATABASE keycloak OWNER keycloak;'
  docker compose up -d keycloak
  ```
  The e2e stack is unaffected — its global-setup uses fresh volumes each run, so
  every e2e run re-imports `realm.e2e.json` clean.
- Keep `realm.json` and `realm.e2e.json` in step when adding roles, clients, or
  mappers — the e2e variant differs only in environment-specific URLs/ports.
- Services verify JWTs against this realm's JWKS (RS256) and check
  `realm_access.roles`. Keycloak is fronted by nginx under the `/kc` path
  prefix (`KC_HTTP_RELATIVE_PATH=/kc`) so the browser stays single-origin;
  services reach it backchannel via `KEYCLOAK_INTERNAL_URL`
  (`http://keycloak:8080/kc`). The browser-facing issuer is
  `http://localhost:8080/kc/realms/betting` (dev).
