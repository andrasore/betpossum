#!/usr/bin/env bash
# Seal the prod Secrets the prod overlay expects but does not ship.
# See k8s/README.md § "(prod) Seal the secrets" for the why.
#
# Passwords are generated once and reused where a value appears twice (a
# connection URL the apps read, and the discrete var the server reads), so the
# two copies can never disagree. Override any of them via the environment to
# rotate a single value: `DB_PASSWORD=... ./k8s/seal-secrets.sh`.
#
# Required:
#   CORE_CLIENT_SECRET   betting-core's confidential client secret (Keycloak
#                        admin console -> clients -> betting-core -> Credentials).
# Optional (auto-generated with [A-Za-z0-9] if unset):
#   DB_PASSWORD MQ_PASSWORD KC_DB_PASSWORD KC_ADMIN_PASSWORD
# Optional TLS (sealed only if both files exist):
#   TLS_CRT (default tls.crt)   TLS_KEY (default tls.key)
set -euo pipefail

gen() { LC_ALL=C tr -dc 'A-Za-z0-9' </dev/urandom | head -c 32; }

: "${CORE_CLIENT_SECRET:?set CORE_CLIENT_SECRET (betting-core client credential)}"
: "${DB_PASSWORD:=$(gen)}"
: "${MQ_PASSWORD:=$(gen)}"
: "${KC_DB_PASSWORD:=$(gen)}"
: "${KC_ADMIN_PASSWORD:=$(gen)}"

OUT=${OUT:-k8s/overlays/prod/sealed-secrets.yaml}
TLS_CRT=${TLS_CRT:-tls.crt}
TLS_KEY=${TLS_KEY:-tls.key}
SEAL=(kubeseal --format yaml --controller-name sealed-secrets --controller-namespace kube-system)

# --dry-run=client builds each Secret without sending it anywhere; only the
# encrypted output is written to disk.
kubectl create secret generic betpossum-app-secrets -n betpossum \
  --from-literal=DATABASE_URL="postgresql://betting:${DB_PASSWORD}@postgres:5432/betting" \
  --from-literal=RABBITMQ_URL="amqp://betting:${MQ_PASSWORD}@rabbitmq:5672" \
  --from-literal=KEYCLOAK_ADMIN_CLIENT_SECRET="${CORE_CLIENT_SECRET}" \
  --from-literal=THE_ODDS_API_KEY="${THE_ODDS_API_KEY:-}" \
  --from-literal=APIFOOTBALL_API_KEY="${APIFOOTBALL_API_KEY:-}" \
  --dry-run=client -o yaml | "${SEAL[@]}" > "$OUT"

printf -- '---\n' >> "$OUT"
kubectl create secret generic postgres-secret -n betpossum \
  --from-literal=POSTGRES_DB=betting \
  --from-literal=POSTGRES_USER=betting \
  --from-literal=POSTGRES_PASSWORD="${DB_PASSWORD}" \
  --dry-run=client -o yaml | "${SEAL[@]}" >> "$OUT"

printf -- '---\n' >> "$OUT"
kubectl create secret generic rabbitmq-secret -n betpossum \
  --from-literal=RABBITMQ_DEFAULT_USER=betting \
  --from-literal=RABBITMQ_DEFAULT_PASS="${MQ_PASSWORD}" \
  --dry-run=client -o yaml | "${SEAL[@]}" >> "$OUT"

printf -- '---\n' >> "$OUT"
kubectl create secret generic keycloak-secret -n betpossum \
  --from-literal=KC_DB_PASSWORD="${KC_DB_PASSWORD}" \
  --from-literal=KC_BOOTSTRAP_ADMIN_USERNAME=admin \
  --from-literal=KC_BOOTSTRAP_ADMIN_PASSWORD="${KC_ADMIN_PASSWORD}" \
  --dry-run=client -o yaml | "${SEAL[@]}" >> "$OUT"

# TLS cert the Ingress serves. Nothing renews this in-cluster; re-run when you
# rotate it. Sealed only when both files are present.
if [[ -f "$TLS_CRT" && -f "$TLS_KEY" ]]; then
  printf -- '---\n' >> "$OUT"
  kubectl create secret tls betpossum-tls -n betpossum \
    --cert="$TLS_CRT" --key="$TLS_KEY" \
    --dry-run=client -o yaml | "${SEAL[@]}" >> "$OUT"
else
  echo "warning: ${TLS_CRT}/${TLS_KEY} not found; skipped betpossum-tls (the Ingress tls block needs it)" >&2
fi

echo "Wrote $OUT"
