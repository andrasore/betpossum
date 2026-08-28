#!/bin/bash
# Renders the `betting` realm from keycloak/realm.template.json, then hands off
# to Keycloak. This is the entrypoint for **every** stack — dev, e2e and the
# Coolify production deploy — which is why there is only one realm file.
#
# Why render at all: the redirect URIs, web origins, SSL policy and the
# `betting-core` client secret are the only things that differ per environment,
# and the production client secret must not be committed. Keycloak's own ${VAR}
# placeholder substitution for import files is documented but has never worked
# reliably (keycloak/keycloak#20199, closed as not-planned), so the substitution
# happens here instead — plain bash, no extra tooling in the image.
#
# Bound in as the container entrypoint; the image's CMD
# (`start --optimized --import-realm`) arrives as "$@".
#
# NOTE: --import-realm only imports a realm that does not already exist. Once
# `betting` is in the keycloak database this file is rendered and then ignored.
# Changing PUBLIC_ORIGIN or the client secret afterwards requires dropping and
# recreating the keycloak database — see docs/DEPLOYMENT.md.
set -euo pipefail

: "${PUBLIC_ORIGIN:?PUBLIC_ORIGIN must be set}"
: "${KEYCLOAK_ADMIN_CLIENT_SECRET:?KEYCLOAK_ADMIN_CLIENT_SECRET must be set}"
: "${SSL_REQUIRED:?SSL_REQUIRED must be set (none for dev/e2e, external in production)}"

template=/opt/betpossum/realm.template.json
target=/opt/keycloak/data/import/realm.json

realm=$(cat "$template")
realm=${realm//__PUBLIC_ORIGIN__/$PUBLIC_ORIGIN}
realm=${realm//__CORE_CLIENT_SECRET__/$KEYCLOAK_ADMIN_CLIENT_SECRET}
realm=${realm//__SSL_REQUIRED__/$SSL_REQUIRED}

if [[ $realm == *__PUBLIC_ORIGIN__* || $realm == *__CORE_CLIENT_SECRET__* || $realm == *__SSL_REQUIRED__* ]]; then
  echo "render-realm: placeholder left unsubstituted in $template" >&2
  exit 1
fi

mkdir -p "$(dirname "$target")"
printf '%s' "$realm" > "$target"
echo "render-realm: wrote $target for origin $PUBLIC_ORIGIN"

exec /opt/keycloak/bin/kc.sh "$@"
