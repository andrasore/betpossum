-- One Postgres instance for the whole stack, two databases:
--   * keycloak — Keycloak's own schema and credentials, isolated from app data.
--   * betting  — every application service, one schema each (core/odds/stats).
--
-- The official image runs this once, on the first init of an empty data volume,
-- connected to POSTGRES_DB (betting) as the bootstrap superuser POSTGRES_USER
-- (betting). So the CREATE SCHEMA statements land in `betting` and are owned by
-- the app role, while CREATE DATABASE provisions Keycloak's separate store.

-- Keycloak keeps its own database and login role.
CREATE ROLE keycloak WITH LOGIN PASSWORD 'keycloak_dev';
CREATE DATABASE keycloak OWNER keycloak;

-- One schema per application service inside the shared `betting` database.
-- Core (TypeORM) cannot create its own schema, so infra owns all three; odds
-- and stats also CREATE SCHEMA IF NOT EXISTS defensively at startup.
CREATE SCHEMA IF NOT EXISTS core AUTHORIZATION betting;
CREATE SCHEMA IF NOT EXISTS odds AUTHORIZATION betting;
CREATE SCHEMA IF NOT EXISTS stats AUTHORIZATION betting;
