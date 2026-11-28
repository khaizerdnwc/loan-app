#!/usr/bin/env bash
# Rehearse a restore: back up a source database with backup.sh, restore it with restore.sh
# into a throwaway Postgres 16 container, and compare the two — every table's row count in
# both schemas, the applied migrations, every sequence's position (loan_case_ref_seq: a reset
# would reissue case references), the triggers with their enabled state (the insert-only and
# TRUNCATE guards) and every foreign key (validated, delete rule). Exits
# non-zero on any difference; the container is always removed. The source is only read.
#
#   SRC_CONTAINER=loan-app-postgres \
#   SRC_URL=postgres://loan:loan_dev_password@127.0.0.1:5432/loan_dev \
#     scripts/db/rehearse-restore.sh
#
# SRC_URL is the source as seen from inside SRC_CONTAINER (whose client tools are used).
set -euo pipefail

: "${SRC_CONTAINER:?set SRC_CONTAINER to the running Postgres container holding the source}"
: "${SRC_URL:?set SRC_URL to the source database URL, as seen from inside SRC_CONTAINER}"
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# Same image as docker-compose.yml (pinned by digest).
image="postgres:16-alpine@sha256:f2f98726820d0342055351c6e9d36e705f5bfffb3dd53ff556325114b08afb6d"
target="loan-restore-rehearsal-$$"
work="$(mktemp -d)"
trap 'docker rm -f "$target" >/dev/null 2>&1 || true; rm -rf "$work"' EXIT

echo "▸ backup"
PG_CONTAINER="$SRC_CONTAINER" DATABASE_URL="$SRC_URL" "$here/backup.sh" "$work/rehearsal.dump"

echo "▸ throwaway target container"
# A local throwaway password, not a secret.
docker run -d --name "$target" -e POSTGRES_USER=loan -e POSTGRES_PASSWORD=rehearsal \
  -e POSTGRES_DB=restored "$image" >/dev/null
for _ in $(seq 1 60); do
  docker exec "$target" pg_isready -U loan -d restored -h 127.0.0.1 >/dev/null 2>&1 && break
  sleep 1
done
dst_url="postgres://loan:rehearsal@127.0.0.1:5432/restored"

echo "▸ restore"
PG_CONTAINER="$target" DATABASE_URL="$dst_url" RESTORE_CONFIRM=127.0.0.1:5432/restored \
  "$here/restore.sh" "$work/rehearsal.dump"

echo "▸ compare"
# One line per fact: every table's row count, every applied migration, every user trigger.
snapshot_sql="
CREATE TEMP TABLE facts(f text);
DO \$\$ DECLARE r record; n bigint; BEGIN
  FOR r IN SELECT schemaname, tablename FROM pg_tables WHERE schemaname IN ('public','sim') LOOP
    EXECUTE format('SELECT count(*) FROM %I.%I', r.schemaname, r.tablename) INTO n;
    INSERT INTO facts VALUES ('rows ' || r.schemaname || '.' || r.tablename || ' ' || n);
  END LOOP;
END \$\$;
INSERT INTO facts SELECT 'migration ' || name FROM migrations;
INSERT INTO facts SELECT 'sequence ' || schemaname || '.' || sequencename || ' '
  || coalesce(last_value::text, 'unused') FROM pg_sequences WHERE schemaname IN ('public','sim');
INSERT INTO facts SELECT 'trigger ' || tgrelid::regclass || ' ' || tgname || ' enabled=' || tgenabled::text
  FROM pg_trigger WHERE NOT tgisinternal;
INSERT INTO facts SELECT 'fk ' || conrelid::regclass || ' ' || conname || ' validated=' || convalidated
  || ' on_delete=' || confdeltype::text FROM pg_constraint WHERE contype = 'f';
SELECT f FROM facts ORDER BY f;"
docker exec -i "$SRC_CONTAINER" psql -X -q -tA -v ON_ERROR_STOP=1 "$SRC_URL" \
  <<<"$snapshot_sql" >"$work/source.txt"
docker exec -i "$target" psql -X -q -tA -v ON_ERROR_STOP=1 "$dst_url" \
  <<<"$snapshot_sql" >"$work/restored.txt"
if ! diff -u "$work/source.txt" "$work/restored.txt"; then
  echo "rehearsal: FAILED — the restored database differs from the source" >&2
  exit 1
fi
tables=$(grep -c '^rows ' "$work/source.txt")
rows=$(awk '/^rows /{s+=$3} END{print s+0}' "$work/source.txt")
migrations=$(grep -c '^migration ' "$work/source.txt")
triggers=$(grep -c '^trigger ' "$work/source.txt")
sequences=$(grep -c '^sequence ' "$work/source.txt" || true)
fks=$(grep -c '^fk ' "$work/source.txt" || true)
echo "rehearsal: ✅ restored copy matches — $tables tables, $rows rows, $migrations migrations, $sequences sequences (positions), $triggers triggers (enabled state), $fks foreign keys"
grep '^sequence \|^trigger \|^fk ' "$work/source.txt"
