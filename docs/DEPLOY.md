# Deploying

Host-neutral: one `Dockerfile` with two targets, plus a managed or containerised Postgres 16.
No provider-specific files. The challenge's dev environment is not yet named
(`docs/BUILD-STATUS.md`, M10).

## Images

```bash
docker build --target api -t loan-api .   # NestJS API, port 3101
docker build --target web -t loan-web .   # Next.js backoffice, port 3100
```

On start, the API applies pending migrations, runs the idempotent synthetic seed, then serves.
Each step is safe to repeat on restart. Migrations run under a Postgres advisory lock
(`packages/base/src/database/migration-lock.ts`), both from the image's `db.js migrate` and
with `MIGRATE_ON_BOOT=true`: several API replicas can start at once; the first applies the
pending migrations and the others wait for it, then find nothing to do. A waiter gives up
with an error after `MIGRATION_LOCK_TIMEOUT_MS` (default 300000, five minutes) and migrates
nothing; the container then exits and restarts. A holder that dies frees the lock when its
connection closes. The seed upserts, so concurrent seeds are safe too. Both images report health (`HEALTHCHECK`: API `/health`,
backoffice `/sign-in`).

The final images hold a production-only install: `pnpm deploy --prod` copies each app with
its runtime dependencies, the built workspace packages it uses (their `dist`), and only the
files its `package.json` lists (API: `dist`; backoffice: `.next`, without its cache,
`next.config.ts` and `public`). No devDependencies, sources, tests, env files or other apps.

Image smoke run (integrator, 28 Nov 2026, `docker compose up --build` with a throwaway
`JWT_SECRET`, torn down with `-v`): the API image is 490 MB and the backoffice 1.02 GB (both
were 1.92 GB). The API came up healthy, applied 7 migrations and seeded on boot; `/health`
200; `/docs` 404 (Swagger off by default); sign-in with a wrong password 401, the right one
200. The backoffice served `/sign-in` 200 after about 6 s, and through its proxy sign-in
200 and `/cases?view=queue` 200. Before that, the deploy output was smoke-tested outside
Docker (API `node_modules` 123 MB; backoffice `node_modules` 385 MB, `.next` 12 MB).

## Configuration

| Service | Variable | Value |
|---|---|---|
| api | `DATABASE_URL` | `postgres://…` (the lending database) |
| api | `JWT_SECRET` | 32+ random characters (`openssl rand -hex 32`); the example value is refused |
| api | `CORS_ORIGIN` | the backoffice's public URL |
| api | `NODE_ENV` | `production` (the image sets it): the session cookie is then `Secure`, so serve over HTTPS |
| api | `TRUST_PROXY_HOPS` | `0` unless an appending load balancer sits in front of the API |
| api | `EXPIRY_SWEEP_SECONDS` | `300` (default): seconds between expiry sweeps (drafts after 30 days, offers after 5). `0` turns the sweep off; run one API instance with it on, or accept that two instances sweep (each case is still expired once, under a row lock) |
| api | `SWAGGER_ENABLED` | leave unset (off). `true` serves Swagger at `/docs`; only local development's `.env.example` sets it |
| web | `API_URL` | the API's internal URL, e.g. `http://api:3101` (required in production) |

Only the backoffice needs to be public. The browser talks only to the backoffice's `/api`
proxy, so the API can stay on a private network. Swagger is not served unless
`SWAGGER_ENABLED=true`. The proxy forwards request bodies up to 100 KiB, and gives the whole
exchange (the client's body, then the API's answer) 15 seconds.

## Rehearse locally

```bash
JWT_SECRET=$(openssl rand -hex 32) docker compose up --build
# backoffice http://localhost:8100 · API http://localhost:8101/health
```

Rehearsed by hand on 27 Nov 2026 (not a gate stage): migrations applied (3), the seed ran,
`/health` returned ok, and `/sign-in` was served through the backoffice proxy. The gate's e2e stage covers the same path from built sources.

## Checks after deploying

1. `GET <api>/health` → `{"status":"ok"}`.
2. Sign in with each test account (docs/TEST-ACCOUNTS.md: the usernames and the shared test
   password) and run F1 (Maria) and F2 (Joel) as in `docs/ACCEPTANCE.md`.
3. As Leo, switch a simulator to OUTAGE and back. A non-OK mode resets itself after 15
   minutes, so a reviewer cannot leave the demo broken.

## Test credentials on a shared environment

The seed sets the published test password (`Password123!`, docs/TEST-ACCOUNTS.md) on every
staff account. The repository is public, so a deployed environment seeded this way is open to
anyone who reads it. That is acceptable for this synthetic-data demo and for nothing else.

## Before upgrading an existing database

Migration 1764300000005 adds a partial unique index: one open application per applicant and
product (INT-007). It fails if the database already holds duplicates. Check first, and
decline or finish the extra cases before migrating:

```sql
SELECT applicant_id, product_code, count(*) FROM loan_case
WHERE status NOT IN ('DECLINED', 'DISBURSED') GROUP BY 1, 2 HAVING count(*) > 1;
```

A fresh environment has nothing to check: the seed creates no cases.

## Backup and restore

Two scripts wrap the Postgres 16 client tools (`pg_dump`, `pg_restore`). Run them where those
tools are installed, or set `PG_CONTAINER` to a running `postgres:16` container to use its
tools (`DATABASE_URL` is then as seen from inside that container). Neither prints the URL.

```bash
# Back up: one custom-format file (both schemas, the migrations table, data, triggers),
# checked with pg_restore --list before it is kept; created readable by the owner only.
DATABASE_URL=postgres://… scripts/db/backup.sh backups/loan-$(date +%Y%m%d-%H%M).dump

# Restore: drops and recreates every object in the backup and reloads the data, in one
# transaction (any error rolls it all back). RESTORE_CONFIRM must be the target's
# <host:port>/<name>, exactly as the refusal message prints it.
RESTORE_CONFIRM=db.internal:5432/loan DATABASE_URL=postgres://…@db.internal:5432/loan \
  scripts/db/restore.sh backups/loan-….dump
```

Stop the API first (the script cannot tell). `restore.sh` refuses before restoring anything:
with exit 2 when `RESTORE_CONFIRM` is not the target's `<host:port>/<name>` or the URL names
no database (no database is contacted), and with exit 3 when the target already has
migrations and its latest differs from the backup's (a restore drops only the backup's own
objects, so a newer table would survive while the migrations table is rewound). Restore into
an empty database, or one at the same migration head; then start the API, and
`MIGRATE_ON_BOOT` applies any newer migrations. The refusals are tested in
`apps/api/test/db-scripts.test.ts` with stand-in client tools.

`scripts/db/rehearse-restore.sh` proves a backup restores: it backs up a source database,
restores it into a throwaway Postgres 16 container (the image pinned in docker-compose.yml),
and compares every table's row count in both schemas, the applied migrations, every
sequence's position (`loan_case_ref_seq`: a reset would reissue case references) and the
triggers with their enabled state, then removes the container. Rehearsed on 28 Nov 2026
against a test database holding booked cases: 16 tables, 137 rows, 7 migrations, 5 sequence
positions and 3 enabled triggers matched.

```bash
SRC_CONTAINER=loan-app-postgres \
SRC_URL=postgres://loan:loan_dev_password@127.0.0.1:5432/loan_dev scripts/db/rehearse-restore.sh
```

Scheduling backups and keeping them off the database host belong to the hosting
environment, which is not yet named (M10).

## Rollback

Redeploy the previous image tags. The migrations only add (no destructive `down` is run on
deploy), so the previous API runs against the newer schema.
