#!/usr/bin/env bash
# Builds and starts the stack, runs the regression pack, then removes the stack and its database
# whatever the outcome. Extra arguments go to `playwright test` (e.g. --headed, a spec path).
set -euo pipefail

cd "$(dirname "$0")"
export REGRESSION_PORT="${REGRESSION_PORT:-8090}"
export REGRESSION_PUID="$(id -u)" REGRESSION_PGID="$(id -g)"
if docker compose version > /dev/null 2>&1; then
  compose=(docker compose -f docker-compose.yml)
else
  compose=(docker-compose -f docker-compose.yml)
fi

teardown() {
  status=$?
  if [ "$status" -ne 0 ]; then
    mkdir -p test-results
    "${compose[@]}" logs --no-color > test-results/stack.log 2>&1 || true
  fi
  "${compose[@]}" down --volumes --remove-orphans > /dev/null 2>&1 || true
  rm -rf consume fake-provider-gates
  exit "$status"
}
trap teardown EXIT

# A previous run that was killed before its teardown would otherwise leave old data in place.
"${compose[@]}" down --volumes --remove-orphans > /dev/null 2>&1 || true
# The backend's watched consume folder, bind-mounted so tests can drop files into it, and likewise what lets the fake
# provider's held imports go.
rm -rf consume fake-provider-gates && mkdir consume fake-provider-gates
"${compose[@]}" up --build --detach --wait

BASE_URL="http://localhost:${REGRESSION_PORT}" npx playwright test "$@"
