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
#   exit 3  the target already has migrations and their set differs from the backup's (a
#           restore drops only the backup's objects, so a table from a migration the backup
#           lacks would survive while the migrations table is rewound). The whole set is
#           compared, not the latest: lanes merge migrations out of timestamp order, so two
#           databases can share the latest and still differ. Restore into an empty database.
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

# The applied migrations in the backup and in the target (none when it has no migrations
# table), one name per line, sorted.
backup_set="$(pg_tool pg_restore --data-only --table=migrations --file=- <"$in" | awk -F'\t' '
  /^COPY .*migrations / { copying = 1; next }
  copying && $0 == "\\." { copying = 0; next }
  copying { print $3 }' | LC_ALL=C sort)"
backup_count="$(printf '%s' "$backup_set" | grep -c . || true)"
has_table="$(pg_tool psql -X -q -tA -v ON_ERROR_STOP=1 --dbname="$DATABASE_URL" \
  -c "SELECT to_regclass('public.migrations') IS NOT NULL")"
if [[ "$has_table" == "t" ]]; then
  target_set="$(pg_tool psql -X -q -tA -v ON_ERROR_STOP=1 --dbname="$DATABASE_URL" \
    -c "SELECT name FROM migrations" | LC_ALL=C sort)"
  if [[ "$target_set" != "$backup_set" ]]; then
    {
      echo "restore: $target has a different set of migrations from the backup. Restore into an empty database."
      echo "  only in the target: $(LC_ALL=C comm -23 <(echo "$target_set") <(echo "$backup_set") | grep . | paste -sd' ' - || true)"
      echo "  only in the backup: $(LC_ALL=C comm -13 <(echo "$target_set") <(echo "$backup_set") | grep . | paste -sd' ' - || true)"
    } >&2
    exit 3
  fi
fi

pg_tool pg_restore --clean --if-exists --no-owner --no-privileges --single-transaction \
  --exit-on-error --dbname="$DATABASE_URL" <"$in"
echo "restore: $in → $target ($backup_count migrations)"
