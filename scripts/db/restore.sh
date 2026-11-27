#!/usr/bin/env bash
# Restore a backup made by backup.sh into DATABASE_URL, in one transaction: every object in
# the backup is dropped (if present) and recreated, then the data is loaded; any error rolls
# the whole restore back. Stop the API first. See docs/DEPLOY.md "Backup and restore".
#
#   RESTORE_CONFIRM=db.internal:5432/loan DATABASE_URL=postgres://…@db.internal:5432/loan \
#     scripts/db/restore.sh loan.dump
#
# Refuses, before restoring anything:
#   exit 2  RESTORE_CONFIRM is not the target's <host:port>/<name> (as printed in the message),
#           or DATABASE_URL names no database — checked before any database is contacted;
#   exit 3  the target already has migrations and its latest differs from the backup's (a
#           restore drops only the backup's objects, so a newer table would survive while the
#           migrations table is rewound). Restore into an empty database instead.
set -euo pipefail

in="${1:?usage: restore.sh <backup-file>}"
: "${DATABASE_URL:?set DATABASE_URL to the database to restore into}"
[[ -r "$in" ]] || {
  echo "restore: cannot read $in" >&2
  exit 1
}
# shellcheck source=scripts/db/pg-tools.sh
source "$(dirname "${BASH_SOURCE[0]}")/pg-tools.sh"

if ! db_name >/dev/null; then
  echo "restore: DATABASE_URL names no database (expected postgres://…/<name>)." >&2
  exit 2
fi
target="$(db_label)"
if [[ "${RESTORE_CONFIRM:-}" != "$target" ]]; then
  echo "restore: this replaces the backed-up tables in database $target. Re-run with RESTORE_CONFIRM=$target." >&2
  exit 2
fi

# The latest migration in the backup, and in the target (none when it has no migrations table).
backup_head="$(pg_tool pg_restore --data-only --table=migrations --file=- <"$in" | awk -F'\t' '
  /^COPY .*migrations / { copying = 1; next }
  copying && $0 == "\\." { copying = 0; next }
  copying && $2 + 0 > best { best = $2 + 0; name = $3 }
  END { print (name == "" ? "<none>" : name) }')"
has_table="$(pg_tool psql -X -q -tA -v ON_ERROR_STOP=1 --dbname="$DATABASE_URL" \
  -c "SELECT to_regclass('public.migrations') IS NOT NULL")"
if [[ "$has_table" == "t" ]]; then
  target_head="$(pg_tool psql -X -q -tA -v ON_ERROR_STOP=1 --dbname="$DATABASE_URL" \
    -c "SELECT coalesce((SELECT name FROM migrations ORDER BY timestamp DESC, id DESC LIMIT 1), '<none>')")"
  if [[ "$target_head" != "$backup_head" ]]; then
    echo "restore: $target is at migration $target_head but the backup is at $backup_head. Restore into an empty database." >&2
    exit 3
  fi
fi

pg_tool pg_restore --clean --if-exists --no-owner --no-privileges --single-transaction \
  --exit-on-error --dbname="$DATABASE_URL" <"$in"
echo "restore: $in → $target (migration head $backup_head)"
