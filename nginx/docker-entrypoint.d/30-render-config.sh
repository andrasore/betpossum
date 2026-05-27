#!/bin/sh
# Renders /usr/share/nginx/html/config.js from env vars before nginx starts.
# The nginx:alpine entrypoint sources every executable file in this directory
# during startup, so the SPA always boots with a fresh runtime config.

set -eu
: "${KEYCLOAK_ISSUER:?KEYCLOAK_ISSUER is required}"
: "${KEYCLOAK_CLIENT_ID:=betting-frontend}"
export KEYCLOAK_ISSUER KEYCLOAK_CLIENT_ID
envsubst '${KEYCLOAK_ISSUER} ${KEYCLOAK_CLIENT_ID}' \
  < /etc/nginx/templates/config.js.template \
  > /usr/share/nginx/html/config.js
