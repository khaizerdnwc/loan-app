#!/usr/bin/env bash
# Back up the lending database to one file: pg_dump custom format, both schemas (public and
# the simulators' sim), the migrations table, data and the insert-only triggers. The file is
# checked with pg_restore --list before it is kept. See docs/DEPLOY.md "Backup and restore".
#
#   DATABASE_URL=postgres://… scripts/db/backup.sh backups/loan-$(date +%Y%m%d-%H%M).dump
#   PG_CONTAINER=loan-app-postgres DATABASE_URL=postgres://loan:…@127.0.0.1:5432/loan_dev \
#     scripts/db/backup.sh loan_dev.dump        # client tools from the container
#
# The data is synthetic, but a backup holds everything the database holds: keep it private.
set -euo pipefail

out="${1:?usage: backup.sh <output-file>}"
: "${DATABASE_URL:?set DATABASE_URL to the database to back up}"
# shellcheck source=scripts/db/pg-tools.sh
source "$(dirname "${BASH_SOURCE[0]}")/pg-tools.sh"

umask 077
partial="$out.partial"
trap 'rm -f "$partial"' EXIT
pg_tool pg_dump --format=custom --no-owner --no-privileges --dbname="$DATABASE_URL" >"$partial"
# A backup that cannot be read is not a backup.
pg_tool pg_restore --list <"$partial" >/dev/null
mv "$partial" "$out"
trap - EXIT
echo "backup: $(db_label) → $out ($(wc -c <"$out" | tr -d ' ') bytes)"
