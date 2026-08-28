#!/bin/bash
# Container healthcheck for the Keycloak service in docker-compose.coolify.yml.
#
# Lives in a file rather than inline in the compose `test:` because the raw HTTP
# request needs literal CRLFs, and how a YAML scalar hands those to bash is the
# kind of detail that breaks silently.
#
# Fetches the realm's OIDC discovery document over bash's /dev/tcp — the image
# ships no curl or wget, and Keycloak's own /health/ready needs KC_HEALTH_ENABLED
# baked in at build time. Probing the realm rather than the port also proves the
# import in render-realm.sh actually finished; this is the same document the e2e
# harness waits on.
set -euo pipefail

exec 3<>/dev/tcp/127.0.0.1/8080

printf 'GET /kc/realms/betting/.well-known/openid-configuration HTTP/1.1\r\n' >&3
printf 'Host: localhost\r\n' >&3
printf 'Connection: close\r\n\r\n' >&3

head -n 1 <&3 | grep -q ' 200 '
