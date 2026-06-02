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
- Keycloak runs against its **own** dedicated Postgres instance, separate from
  Core's database.

## Conventions

- **Realm config is import-only.** Edit the `realm*.json` files and let
  `--import-realm` apply them on boot; don't hand-tweak through the admin UI and
  expect it to persist — changes there are lost on the next clean boot.
- **`--import-realm` only imports a realm that does not already exist.** Once the
  `betting` realm is persisted in the `keycloak_postgres_data` volume, edits to
  `realm.json` (a new `loginTheme`, client, role, mapper…) are **silently
  ignored** on a plain `docker compose up -d keycloak`. To pick up dev realm
  changes, wipe the volume and re-import:
  ```bash
  docker compose stop keycloak keycloak_postgres
  docker compose rm -f keycloak keycloak_postgres
  docker volume rm betpossum_keycloak_postgres_data
  docker compose up -d keycloak
  ```
  The e2e stack is unaffected — its global-setup uses fresh volumes each run, so
  every e2e run re-imports `realm.e2e.json` clean.
- Keep `realm.json` and `realm.e2e.json` in step when adding roles, clients, or
  mappers — the e2e variant differs only in environment-specific URLs/ports.
- Services verify JWTs against this realm's JWKS (RS256) and check
  `realm_access.roles`. Keycloak is **not** behind nginx — it's reached
  directly on its own port for the login redirect.
