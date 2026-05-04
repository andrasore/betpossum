#!/usr/bin/env bash
# protobuf_guard.sh — ensures generated protobuf files are always in sync with
# their .proto sources before a commit is accepted.
#
# For each service it:
#   1. Runs `npm run proto:gen` to (re)generate the protobuf output in-place.
#   2. Checks `git diff` on the service's generated/ directory.
#   3. Rejects the commit if any generated file differs from what is staged,
#      listing the affected paths so the developer knows what to re-stage.
set -uo pipefail

REPO_ROOT="$(git rev-parse --show-toplevel)"

proto_gen() {
  local service=$1
  local dir="$REPO_ROOT/services/$service"

  if [ "$service" = "core" ]; then
    if [ ! -d "$dir/node_modules/@protobuf-ts" ]; then
      echo "  warning: can't start $service proto:gen (run npm install)"
      return 1
    fi
  else
    if [ ! -d "$dir/.venv" ]; then
      echo "  warning: can't start $service proto:gen (run npm run init)"
      return 1
    fi
  fi

  npm --prefix "$dir" run proto:gen --silent 2>&1
}

proto_gen core
proto_gen odds
proto_gen wallet

# Collect any generated directories that now differ from the index.
GENERATED=(
  services/core/src/generated
  services/odds/src/generated
  services/wallet/src/generated
)

dirty=()
for path in "${GENERATED[@]}"; do
  if ! git -C "$REPO_ROOT" diff --quiet -- "$path"; then
    dirty+=("$path")
  fi
done

if [ ${#dirty[@]} -gt 0 ]; then
  echo ""
  echo "error: generated protobuf files are out of sync with the .proto sources."
  echo "  Stage the following and try again:"
  for path in "${dirty[@]}"; do
    echo "    $path"
  done
  echo ""
  exit 1
fi
