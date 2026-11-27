#!/usr/bin/env bash
# Shared by backup.sh and restore.sh (sourced, not run). Runs a Postgres client tool either in
# a running Postgres container (PG_CONTAINER=<name>; DATABASE_URL is then as seen from inside
# it) or from the local PATH. Use client tools of the server's major version (16).
# DATABASE_URL carries a password: it is never printed; db_label shows host, port and name.

pg_tool() {
  local tool="$1"
  shift
  if [[ -n "${PG_CONTAINER:-}" ]]; then
    docker exec -i "$PG_CONTAINER" "$tool" "$@"
  elif command -v "$tool" >/dev/null 2>&1; then
    "$tool" "$@"
  else
    echo "$tool is not installed. Install the Postgres 16 client tools, or set PG_CONTAINER to a running postgres:16 container." >&2
    return 127
  fi
}

# host:port/name of DATABASE_URL, without credentials or query string.
db_label() {
  local rest="${DATABASE_URL#*://}"
  rest="${rest##*@}"
  echo "${rest%%\?*}"
}

# The database name in DATABASE_URL; fails (status 1) when the URL names no database.
db_name() {
  local label name
  label="$(db_label)"
  [[ "$label" == */* ]] || return 1
  name="${label##*/}"
  [[ -n "$name" ]] || return 1
  echo "$name"
}
