#!/bin/sh
# One Postgres instance for the whole stack, two databases:
#   * keycloak — Keycloak's own schema and credentials, isolated from app data.
#   * betting  — every application service, one schema each (core/odds/stats).
#
# The official image runs this once, on the first init of an empty data volume,
# connected to POSTGRES_DB (betting) as the bootstrap superuser POSTGRES_USER
# (betting). So the CREATE SCHEMA statements land in `betting` and are owned by
# the app role, while CREATE DATABASE provisions Keycloak's separate store.
#
# This is a shell script rather than a plain .sql file for one reason: files in
# docker-entrypoint-initdb.d ending in .sql are fed straight to psql and see no
# environment, so Keycloak's DB password could only ever be a literal. Shell
# scripts get the entrypoint's full environment, which lets the Coolify stack
# inject a generated secret while dev/e2e keep the historical default.
set -e

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<EOSQL
-- Keycloak keeps its own database and login role.
CREATE ROLE keycloak WITH LOGIN PASSWORD '${KEYCLOAK_DB_PASSWORD:-keycloak_dev}';
CREATE DATABASE keycloak OWNER keycloak;

-- One schema per application service inside the shared \`betting\` database.
-- Core (TypeORM) cannot create its own schema, so infra owns all three; odds
-- and stats also CREATE SCHEMA IF NOT EXISTS defensively at startup.
CREATE SCHEMA IF NOT EXISTS core AUTHORIZATION $POSTGRES_USER;
CREATE SCHEMA IF NOT EXISTS odds AUTHORIZATION $POSTGRES_USER;
CREATE SCHEMA IF NOT EXISTS stats AUTHORIZATION $POSTGRES_USER;
EOSQL
