# data lessons — log

Full narratives, newest first. **Not loaded** by any skill or agent: the loaded, path-tagged
one-liners are in `lessons.md`. Read one entry with `pnpm lessons show <id>`, or every entry a
rule enforces with `pnpm lessons show house/<rule>`. A `Gate:` line means a machine enforces it.

## data-20261128-booking-failure-after-lost-reply

Gate: test: apps/api/test/compliance-and-audit.e2e-spec.ts (CMP-11)

A booking failure path that stops before the core call (a refusal, a screening match) must not
say "nothing was booked or paid out" on a retry: an earlier attempt may have reached the
simulated core or the disbursement service and lost only the reply, so the account or the
payout already exists under the same idempotency key. Why: the Lane B pre-disbursement
screening (2026-11-28) holds a retried booking with exactly that text, and opens the AML
escalation without noting that the core may already hold an account and a payout for a now
listed person; the record then contradicts the simulator's state. Word the text from
`booking.attempts` / `fromStatus`, or ask the core by key, and pin it with a lost-reply retry
test.

## data-20261128-unique-violation-mapping-forced-test

When a service checks for a duplicate and then relies on a unique index to cover the race,
the code that turns the index's unique violation (23505 on the named index) into a domain 409
must be pinned by a test that **forces** that path: stub or spy the pre-check so it misses once,
or insert the competing row directly in SQL between the check and the insert. Map the violation
after `tx.run` rejects (outside the callback), not inside it. Why: in INT-007 (one open
application, 28 Nov 2026) the race test fired two captures with `Promise.all`. It passes
whether the requests overlap (index path) or run one after the other (pre-check path), so the
catch branch can go untested and a typo in the index name turns a race into a 500 with a green
suite. The catch also read the winner through the default manager while the aborted transaction
still held its connection: two pool connections per request, so a burst of racing captures can
exhaust the pool (max 20, 5 s acquire timeout) instead of answering 409. Nearest deterministic
alternative: a test-candidate per mapping; a check could list every `isUniqueViolation(…, name)`
and require that name to appear in a test.

## data-20261127-precondition-reread-under-lock

A precondition that a service checks before its locked transaction (because providers are
called outside the lock) must be re-read inside the transaction after the row lock, or every
write that can change it must bump the locked row's version so the existing version guard
fires. Why: the gap between the unlocked check and the lock is exactly where a concurrent
edit lands; the decision is then committed against state the guard was meant to refuse, and
the record says nothing about it. Nearest deterministic gate: an integration test that
changes the precondition between the check and the lock (as the "submit race" test does for
terms) for each pre-transaction guard.

- 2026-11-27 — Consent capture (C-1). submit() checked latestConsent() before gatherInputs()
  and never again; a consent-only PATCH records a new consent row but returns before saving
  the case, so loan_case.version does not move and the submit race guard (version) does not
  fire. A withdrawal committed during the bureau call still produces a decision. Found by the
  data reviewer.

## data-20261127-migration-backfill-needs-populated-run

A migration that backfills existing rows (UPDATE … then SET NOT NULL / ADD UNIQUE) or whose
down() matters must be exercised against a database at the previous head *holding seed data*,
then reverted — not only "from empty". Why: the `db` gate stage and the integration
global-setup both migrate an empty database, so the backfill UPDATE touches zero rows and
down() never runs; a collision under the new UNIQUE, a NULL left behind, or a broken down()
reaches every developer's existing database untested. Nearest deterministic gate: a db-stage
step (migrate to N-1, seed, migrate, seed, revert last, migrate) or a check that a migration
containing UPDATE has a matching upgrade test.

- 2026-11-27 — StaffSignIn (1764300000003) backfilled username from id and set a placeholder
  hash, then NOT NULL + UQ_staff_username. Reviewed correct by reasoning (8 seeded ids map to
  8 distinct usernames that equal the seed's, migration runs in its own transaction), but the
  "verify --only db passed" evidence never executed the UPDATE or down(). Found by the data
  reviewer.

## data-20261127-money-parse-limit-matches-column

Gate: test: packages/core/test/money.test.ts

- 2026-11-27 — First reviewed commit. Money.of accepted 13 whole digits while the column is
  numeric(14,2) (12 whole digits), so an oversized amount would pass validation and fail the
  INSERT with a 500. Found by the data reviewer. Fixed by deriving the parse limit from
  MONEY_PRECISION/MONEY_SCALE (also used by the column transformer) and refusing to serialise
  an arithmetic result that overflows; the boundary is tested both ways.

## data-20261127-compare-exact-not-rounded-ratio

Gate: test: packages/base/test/decisioning/decide.test.ts

- 2026-11-27 — Engine review. The DTI cap and the scorecard's DTI bands compared a ratio
  already rounded to 4 decimals, so ₱31,201 on ₱78,000 (40.0013%) passed a 40% cap. Found by
  the data and qa reviewers. Policy now compares exact amounts (obligations > income × cap);
  the 4-decimal ratio is display and record only. Tests sit just either side of 40/30/20%.
