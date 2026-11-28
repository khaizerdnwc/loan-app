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
connection closes. The seed upserts, or fills empty tables idempotently (the holiday calendar is written only into a fresh environment, with `ON CONFLICT DO NOTHING`), so concurrent seeds are safe too. Both images report health (`HEALTHCHECK`: API `/health`,
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
| api | `TRUST_PROXY_HOPS` | `1` only if the API has no public route and no other ingress (only the backoffice reaches it; it passes on the client address alone); otherwise `0`, or a client could choose its own rate-limit bucket by sending `X-Forwarded-For` straight to the API |
| api | `EXPIRY_SWEEP_SECONDS` | `300` (default): seconds between expiry sweeps (drafts after 30 days, offers after 5). `0` turns the sweep off; run one API instance with it on, or accept that two instances sweep (each case is still expired once, under a row lock) |
| api | `NOTIFICATION_SWEEP_SECONDS` | `30` (default): seconds between notification sweeps (waiting borrower messages to the email and SMS gateway, SLA-breach alerts). `0` turns it off (the integration tests do). Two instances sweeping is safe: each claims one message at a time (`FOR UPDATE SKIP LOCKED` with a 120-second lease, which covers one gateway call with a wide margin, not a batch), so they do not send the same message at once, a message is attempted at most once per sweep even beside another sweep, and a sweep whose lease ran out and was taken over writes no outcome; a sweep that dies mid-send leaves its lease to run out and the message is claimed again, which can mean one repeat gateway call (and its cost), never a second message, because the call carries the message's idempotency key (a requirement on every gateway adapter, `notifications.port.ts`); a breach alert is unique per stage visit |
| api | `PROVIDER_RETRY_ATTEMPTS` | `3` (default, 1–5): attempts per decision provider call (bureau, KYC/AML, fraud), the first included; `1` = no retry |
| api | `PROVIDER_RETRY_BASE_MS` | `200` (default): backoff before retry k is base × 2ᵏ⁻¹ plus up to base of jitter; `0` = retry at once. Keep attempts × (provider timeout + backoff) well under the 60 s decision target (NFR-003): the defaults give about 10 s per service at a 3 s timeout, the maximum settings far more |
| api | `PROVIDER_CIRCUIT_THRESHOLD` | `5` (default): failed calls in a row that pause a service (its circuit opens; applications are referred meanwhile) |
| api | `PROVIDER_CIRCUIT_OPEN_MS` | `30000` (default): how long a paused service is skipped before one trial call; `0` = the next call is always a trial, so the breaker never skips a call. The circuit is per API instance and in memory: a restart or a rolling deploy closes it, and with several replicas each counts its own failures, so one replica's open circuit does not stop the others (a best-effort breaker, not a global one) |
| api | `BUREAU_CACHE_DAYS` | `30` (default): days a bureau report is reused for the same applicant and provider mode (PRD IH-005); `0` = never reuse (every decision pulls) |
| api | `SWAGGER_ENABLED` | leave unset (off). `true` serves Swagger at `/docs`; only local development's `.env.example` sets it |
| api | `METRICS_ENABLED` | leave unset (off: `/metrics` answers 404). `true` only if the API has no public route: it serves unauthenticated Prometheus text at `/metrics` for a scraper on the API's private network, and the backoffice never forwards it |
| web | `API_URL` | the API's internal URL, e.g. `http://api:3101` (required in production) |
| web | `WEB_TRUST_PROXY_HOPS` | load balancers in front of the backoffice that append the client address to `X-Forwarded-For`, usually `1` on a hosted platform. The backoffice passes the entry that many from the right to the API, alone. `0` (default): no address is passed on, and anonymous traffic, sign-in included, shares the backoffice's bucket. Never set it higher than the real count: an entry further left is written by the client |

The API's `TRUST_PROXY_HOPS=1` has a precondition: the API is on a private network, or at
least has no public domain or route, so that only the backoffice can reach it. No other
service on the API's network may reach it either: anything that can call the API directly can
send its own `X-Forwarded-For` and pick a rate-limit bucket. If the host gives the API a public
URL, set `0` (and anonymous traffic shares one bucket) until that route is removed. The two settings are named apart on purpose: `TRUST_PROXY_HOPS` (API, counting the
backoffice) and `WEB_TRUST_PROXY_HOPS` (backoffice, counting the balancers in front of it).
The rate-limit counters live in each API replica's memory: with several replicas, each enforces
its own budgets, so the effective limit is up to the replica count times the stated one.

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
4. With `TRUST_PROXY_HOPS=1` on the API: verify the API's public URL does not answer (any
   public hostname the host assigned to the API service times out or refuses). If it answers,
   set `TRUST_PROXY_HOPS=0` until the route is removed.
5. With `WEB_TRUST_PROXY_HOPS` above 0 (the backoffice logs a warning naming it): send failed
   sign-ins through the backoffice's public URL with a forged header that changes on every
   request (`X-Forwarded-For: 1.2.3.<n>`, distinct usernames) and confirm one of them gets 429
   within 61 attempts (the per-source budget is 60 a minute). If none does, the backoffice is
   trusting a client-written entry: lower `WEB_TRUST_PROXY_HOPS` to the real number of
   appending balancers, or to `0`.

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

Migrations are listed in timestamp order, but lanes merged in a different order, so a long-lived
database can apply an older-numbered migration after newer ones. On a database that already ran
1764300002000 (audit log, AML escalations), 1764300002001 and 1764300003000 (automation), the
pending 1764300001000 (requests for information, document checklist) and 1764300001001 (routing
and walk-ins) apply afterwards. That is safe: 1000 and 1001 add columns to `loan_case` and
`applicant`, new tables and a `sim.persona_profile` column; 2000, 2001 and 3000 alter none of
those columns or the open-application index and put no trigger on `loan_case` or `applicant`,
so the 1001 backfill (`owner_id = created_by` for drafts) gives the same result in any order.
1001 gives an owner only to drafts: cases already in review or waiting for information land
unassigned in the team queue, including cases an approver returned before the upgrade (after
it, a returned case goes back to the officer who recommended it). `migration:revert` undoes
migrations in the order they were executed, not by timestamp, so on such a database the first
reverts undo 1001 and then 1000. 1764300001002 (approval matrix) can likewise apply after
9000: it creates `approval_level` and changes only the `staff` approval columns, which 2000
to 9000 neither create nor read (9000's foreign keys are on the case's child tables, not on
`staff`), so the backfill gives the same levels in any order; the rehearsal below ran it after
9000.

1764300001002 (approval matrix) replaces each approver's own limit and grades with a level of
the matrix, fail closed: the highest level contained in the old authority (its limit at most the
old limit, its grades all among the old grades), otherwise none. An approver left with no level
cannot approve until a level is assigned deliberately (by a release in this version: there is
no screen for it yet); nobody gains authority. Rehearsed
on lane A's test database at the prior head (1764300009000), with approvers in the old shape:
₱100,000 / A–B became L1 and ₱1,000,000 / A–C L2 (Ben and Rina); ₱2,500,000 / A–D became L2
(L3's ₱3,000,000 is not contained); ₱9,000,000 / A–E became L3, because L3 is contained in it
(capped there, not widened); ₱500,000 / grade D only and ₱5,000,000 with no grades got no
level; officers stay without one. Reverting and migrating again gave the same levels. L1
approves no overrides, which the old per-person authority did not distinguish, so a junior
approver who approved overrides before the upgrade no longer can. Its `down()` restores the
columns from the level, so an approver comes back with their level's limit and grades (not the
original), and one with no level comes back with none.

Migration 1764300009000 adds foreign keys to the child tables and refuses TRUNCATE on the
insert-only ones. It fails, naming the constraint and applying nothing, if a row points at a
case, loan account, booking request, decision or applicant that does not exist. The
application never writes such a row; to check first (every count must be 0):

```sql
SELECT 'decision_record', count(*) FROM decision_record t WHERE NOT EXISTS (SELECT 1 FROM loan_case p WHERE p.id = t.case_id)
UNION ALL SELECT 'activity_event', count(*) FROM activity_event t WHERE NOT EXISTS (SELECT 1 FROM loan_case p WHERE p.id = t.case_id)
UNION ALL SELECT 'booking_request', count(*) FROM booking_request t WHERE NOT EXISTS (SELECT 1 FROM loan_case p WHERE p.id = t.case_id)
UNION ALL SELECT 'loan_account', count(*) FROM loan_account t WHERE NOT EXISTS (SELECT 1 FROM loan_case p WHERE p.id = t.case_id)
  OR NOT EXISTS (SELECT 1 FROM booking_request p WHERE p.id = t.booking_request_id)
UNION ALL SELECT 'schedule_line', count(*) FROM schedule_line t WHERE NOT EXISTS (SELECT 1 FROM loan_account p WHERE p.id = t.loan_account_id)
UNION ALL SELECT 'disbursement', count(*) FROM disbursement t WHERE NOT EXISTS (SELECT 1 FROM loan_account p WHERE p.id = t.loan_account_id)
UNION ALL SELECT 'loan_case.decision_id', count(*) FROM loan_case t WHERE t.decision_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM decision_record p WHERE p.id = t.decision_id)
UNION ALL SELECT 'consent_record', count(*) FROM consent_record t WHERE NOT EXISTS (SELECT 1 FROM applicant p WHERE p.id = t.applicant_id)
UNION ALL SELECT 'aml_escalation', count(*) FROM aml_escalation t WHERE NOT EXISTS (SELECT 1 FROM applicant p WHERE p.id = t.applicant_id)
UNION ALL SELECT 'provider_call', count(*) FROM provider_call t WHERE t.case_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM loan_case p WHERE p.id = t.case_id);
```

Rehearsed on 28 Nov 2026, by hand, on populated test databases: first 41 cases (10 booked),
then again after lanes B and C landed with every table filled, reconciliation runs, provider
calls and bureau cache included (7 cases, 5 booked, 52 events, 60 schedule lines, 6
reconciliation runs, 21 provider calls, 7 cache rows). Each time: revert to the prior head,
migrate, revert, migrate, with every row count unchanged (11 keys and 7 TRUNCATE guards
on, then off apart from the audit log's own, then on). With an orphan planted at the prior head
(an activity event the first time, a provider call the second) the migration failed on
`FK_activity_event_case` / `FK_provider_call_case` and left the database at the prior head.

## Logs, metrics and the load test

**Logs.** The API writes one bare JSON object per line to stdout for each request (no Nest
prefix or colours, so a platform's collector can parse it; the `/health` probe is counted in the
metrics but not logged):
`{"msg":"request","requestId":"…","method":"GET","route":"/cases/:id","status":200,"durationMs":12,"staffId":"STF-PAOLO"}`.
`route` is the matched pattern (`unmatched` for a 404), never the path, so no id or query
string appears; there is no body, header, token or applicant field, and `staffId` is the
session guard's verified user (null when anonymous). The request id is the caller's
`x-request-id` when it is 8–64 letters, digits, `.`, `_` or `-`, else a new UUID. It is echoed in
the response's `x-request-id`. The backoffice proxy forwards the browser's id (or makes one)
and echoes the API's back, so an id a user reports finds its API log line. Ship stdout to the
host's log store; nothing here aggregates logs.

**Metrics.** With `METRICS_ENABLED=true`, `GET /metrics` serves the Prometheus text format:
`http_requests_total{method,route,status}`, `http_request_duration_seconds{method,route}`
(histogram, 5 ms to 10 s), `loan_provider_attempts{service,outcome}` (since this process
started, read from the shared provider-call table) and `loan_provider_circuit_open{service}`
(this process's circuits). Request metrics are per replica; Prometheus sums them. Scrape it
from the private network only.

**Load test.** `scripts/load/applications.mjs` (plain Node, no dependencies) signs in as a loan
officer and, per application, captures a synthetic walk-in, submits a case for it, reads it
back and lists the queue, at `RATE_PER_MINUTE` starts a minute (default 120, about 17× the
average of 10,000 a day and under the API's 300-a-minute-per-user limit) with `CONCURRENCY`
in flight:

```bash
BASE_URL=http://localhost:3101 APPLICATIONS=300 RATE_PER_MINUTE=120 node scripts/load/applications.mjs
```

**What it writes.** Every application is real data in the target database: one applicant, one
case, a decision record, a consent record, several activity and audit events and the provider
calls, about a dozen rows, most of them in insert-only tables that cannot be deleted
(TRUNCATE is refused too). 300 applications leave about 3,600 rows. So the script refuses any
host but localhost unless `LOAD_CONFIRM` equals the target's host (`LOAD_CONFIRM=lending.example.com`),
and checks its numeric settings (whole numbers in range; `MAX_ERROR_RATE` from 0 to 1). Both
are checked before any request is sent, and a refusal exits 2. Point it at a database you can
throw away, or a demo you are happy to fill with "Load Test …" applicants.

It prints one JSON report and exits 1 when the error rate is above `MAX_ERROR_RATE` (default
0.01):

```json
{
  "baseUrl": "…", "settings": { "applications": 300, "concurrency": 5, "ratePerMinute": 120 },
  "applicationsCompleted": 300, "applicationsPerMinute": 119.6, "requests": 1200,
  "errorRate": 0, "throttled429": 0,
  "operations": { "POST /cases (submit)": { "count": 300, "p50Ms": 0, "p95Ms": 0, "p99Ms": 0, "maxMs": 0, "statuses": { "201": 300 } } },
  "nfr004": { "target": "10,000 applications a day ≈ 6.9 a minute on average", "averageMultipleAchieved": 17.2 }
}
```

Record a run as the date, the target (`BASE_URL`, local or deployed), the settings, and per
operation the p50/p95/p99 and statuses, with the error rate and the multiple achieved. The
integrator runs it at merge. A 3-application smoke run against a local API on 28 Nov 2026
completed with no errors (submit p95 540 ms, simulated providers included).

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
migrations and their set differs from the backup's, naming what is only on each side (a restore drops only the backup's own
objects, so a newer table would survive while the migrations table is rewound). Restore into
an empty database, or one with exactly the same migrations; then start the API, and
`MIGRATE_ON_BOOT` applies any newer migrations. The refusals are tested in
`apps/api/test/db-scripts.test.ts` with stand-in client tools.

`scripts/db/rehearse-restore.sh` proves a backup restores: it backs up a source database,
restores it into a throwaway Postgres 16 container (the image pinned in docker-compose.yml),
and compares every table's row count in both schemas, the applied migrations, every
sequence's position (`loan_case_ref_seq`: a reset would reissue case references), the
triggers with their enabled state and every foreign key (validated, delete rule), then removes
the container. Rehearsed on 28 Nov 2026 against a test database holding booked cases: 16
tables, 137 rows, 7 migrations, 5 sequence positions and 3 enabled triggers matched. Rehearsed
again after H7, against a migrated and seeded test database populated by the operations suite
(booked cases, reconciliation runs, provider calls): 26 tables, 363 rows, 13 migrations, 6
sequence positions, 14 triggers (all 7 TRUNCATE guards enabled) and 19 foreign keys (the 11
from 1764300009000 among them, all validated, NO ACTION) matched.

```bash
SRC_CONTAINER=loan-app-postgres \
SRC_URL=postgres://loan:loan_dev_password@127.0.0.1:5432/loan_dev scripts/db/rehearse-restore.sh
```

Scheduling backups and keeping them off the database host belong to the hosting
environment, which is not yet named (M10).

## Rollback

Redeploy the previous image tags. The migrations only add (no destructive `down` is run on
deploy), so the previous API runs against the newer schema.
