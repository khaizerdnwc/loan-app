#!/usr/bin/env bash
# Throwaway Postgres for `pnpm verify` — `services.sh up` / `services.sh down`.
#
# The same container on a Mac and on the GitHub runner (ADR 0018), on a port that never
# collides with the dev stack. Data lives in tmpfs and is removed on `down`.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
# shellcheck source=scripts/verify/env.sh
. "$ROOT/scripts/verify/env.sh"

# Named after its port, so a worktree that overrides only the ports never removes another
# worktree's container (up() starts with down()).
PREFIX="${VERIFY_CONTAINER_PREFIX:-loan-verify-$VERIFY_PG_PORT}"

down() {
  docker rm -f "$PREFIX-postgres" >/dev/null 2>&1 || true
}

wait_for() { # <description> <command...>
  local what="$1"
  shift
  for _ in $(seq 1 60); do
    if "$@" >/dev/null 2>&1; then return 0; fi
    sleep 1
  done
  echo "✖ $what never became ready" >&2
  return 1
}

up() {
  # A previous run killed hard (SIGKILL, laptop sleep) can leave the container behind.
  down
  docker run -d --name "$PREFIX-postgres" \
    -e POSTGRES_USER=loan -e POSTGRES_PASSWORD=loan_verify -e POSTGRES_DB="$VERIFY_DB" \
    -p "127.0.0.1:${VERIFY_PG_PORT}:5432" \
    --tmpfs /var/lib/postgresql/data \
    "$VERIFY_POSTGRES_IMAGE" >/dev/null

  # pg_isready over TCP: the entrypoint's first, socket-only start answers on the socket
  # before the real server is listening on the port.
  wait_for "postgres" docker exec "$PREFIX-postgres" pg_isready -h 127.0.0.1 -U loan -d "$VERIFY_DB"
  docker exec "$PREFIX-postgres" psql -q -U loan -d "$VERIFY_DB" -c "CREATE DATABASE $VERIFY_E2E_DB" >/dev/null
  echo "✔ postgres up — :$VERIFY_PG_PORT ($VERIFY_DB, $VERIFY_E2E_DB)"
}

case "${1:-}" in
  up) up ;;
  down) down ;;
  *)
    echo "usage: services.sh up|down" >&2
    exit 2
    ;;
esac
