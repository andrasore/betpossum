#!/usr/bin/env bash
# schema_guard.sh — ensures generated binding files (Zod / Pydantic) are always
# in sync with schemas/events.schema.json before a push is accepted.
#
#   1. Runs `pnpm schema:gen` to (re)generate every service's bindings in-place.
#   2. Checks `git diff` on each service's generated/ directory.
#   3. Rejects the push if any generated file differs from what is staged,
#      listing the affected paths so the developer knows what to re-stage.
set -uo pipefail

REPO_ROOT="$(git rev-parse --show-toplevel)"

pnpm -C "$REPO_ROOT" schema:gen 2>&1

# Collect any generated directories that now differ from the index.
GENERATED=(
  frontend/src/generated
  services/core/src/generated
  services/odds/src/generated
  services/notifications/src/generated
)

dirty=()
for path in "${GENERATED[@]}"; do
  if ! git -C "$REPO_ROOT" diff --quiet -- "$path"; then
    dirty+=("$path")
  fi
done

if [ ${#dirty[@]} -gt 0 ]; then
  echo ""
  echo "error: generated bindings are out of sync with schemas/events.schema.json."
  echo "  Stage the following and try again:"
  for path in "${dirty[@]}"; do
    echo "    $path"
  done
  echo ""
  exit 1
fi
