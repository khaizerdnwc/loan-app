# data lessons — log

Full narratives, newest first. **Not loaded** by any skill or agent: the loaded, path-tagged
one-liners are in `lessons.md`. Read one entry with `pnpm lessons show <id>`, or every entry a
rule enforces with `pnpm lessons show house/<rule>`. A `Gate:` line means a machine enforces it.

## data-20261128-reconcile-every-feed-record

A reconciliation accounts for every record in every feed exactly once: it is matched,
reported as a finding, or reported as an orphan. It never drops a record through a `continue`. Why: in Lane B's
`reconcile.ts` (2026-11-28) a lending key with no lending account and no core account skips
the rail's payment under that key. A payout with no account behind it, which is exactly what
reconciliation exists to catch, would leave no trace, and the summary would still add up.
Pin it with a unit property: matched + findings referencing each feed record = feed length.
## data-20261128-history-joins-the-record-it-acted-on

An activity event that acts on a specific decision (a recommendation, an override, an
approval) records that decision's id in its details, and any report over history joins on that
id, not on `loan_case.decision_id`. Why: the case's pointer moves on a re-decision
(RETURN → REVIEW → REDECIDE), so a join through it attributes every earlier action to the
latest decision, and override and agreement rates count against an outcome nobody saw.
Nearest deterministic alternative: an integration test that recommends, returns, re-decides
to a different engine outcome, and asserts the earlier recommendation keeps its outcome.

- 2026-11-28 — Lane C batch 3 (model governance, #26). `GovernanceRepository.recommendations`
  joins `activity_event → loan_case → decision_record ON d.id = c.decision_id`; the RECOMMENDED
  event's details carry no decisionId. Found by the data reviewer.

## data-20261128-input-cache-keyed-on-provenance

A cache whose entries become decision inputs must be keyed (or filtered) on every attribute
the decision record asserts about where its inputs came from — at least the provider mode —
and not only on the subject. Why: the record's `provider_mode` is taken from the wiring at
decision time, while a cache hit returns whatever was stored, possibly by a differently wired
process. The record then states a provenance its inputs do not have, and reproduce cannot
detect it (it replays the stored inputs, which are internally consistent). Nearest
deterministic alternative: a test that seeds a cache row with another mode and asserts a miss.

- 2026-11-28 — Lane C batch 2 (bureau reuse, IH-005). `bureau_report_cache` is keyed on
  `applicant_id` only; `report.mode` is stored in the JSON but never compared with the
  gateway's mode on read. Found by the data reviewer.
## data-20261128-updated-at-is-a-clock

`loan_case.updated_at` is an `@UpdateDateColumn`, and the business rules read it as a clock:
a draft expires DRAFT_EXPIRY_DAYS after it (product.ts `expiryOf`, the expiry sweep), and the
loan officers' queue orders "longest waiting" by it. Every `saveCase()` moves it. Why: a write
that is not a change to the application (pick, reassign, priority, any flag) silently extends
a draft's life, can revive a draft that is past expiry but not yet swept (the sweep's
candidate query then skips it), and sends a long-waiting case to the back of the queue. The
expiry assumption explicitly says only a real change counts. Nearest deterministic gate: an
integration test per non-business write on a draft aged past expiry (refused, or updated_at
unchanged and the sweep still expires it); structurally, give expiry and waiting time their
own columns written only by the events that should move them.

- 2026-11-28 — Queue routing (WF-002). RoutingService.reassign/setPriority accept DRAFT
  (`withOfficers`) and save the case through `saveCase` (TypeORM save → updated_at = now),
  with no `expiryRefusal` check. Reassigning an expired, unswept draft resets its 30-day
  clock. Found by the data reviewer.

## data-20261128-provider-call-outside-lock

Gate: house/no-provider-call-in-transaction

Provider calls through ProviderGateway run before the transaction, never inside `tx.run`. Why:
no row lock is held while a provider answers (ADR 0020). A provider can be slow, retry with
backoff or time out, and inside the transaction the case row stays locked throughout, so every
other request on the case waits behind it and a pooled connection is held. Rule limits: an
alias of the gateway, the gateway passed into the callback, a helper method the callback calls,
a port called directly, or a transaction started another way are not caught.

- 2026-11-28 — Round 3: the case lock became FOR NO KEY UPDATE, which a foreign-key check does
  not wait on, so the gateway's own `provider_call` insert (second connection, FK to loan_case)
  no longer waits on the lock. The rule's reason is the lock duration above; the FK wait is
  history, not the rationale.

- 2026-11-28 — Lane H7 added FK_provider_call_case. Every gateway call today is in
  `gatherInputs`, which runs before `tx.run` (cases.service.ts submit and redecide), so nothing
  hangs yet. The rule makes that ordering a gate. Found by the data reviewer.

## data-20261128-insert-only-guards-from-catalogue

A guard that must cover "every insert-only table" (a TRUNCATE refusal, the harness reset, a
foreign-key inventory) is tested against the set the database itself reports, the tables
carrying a row-level `refuse_change()` UPDATE/DELETE trigger in `pg_trigger`, not against a
table list typed into the migration and the test. Why: lanes build in parallel worktrees, and
each adds its own insert-only table with only the row trigger. A hard-coded list stays green
on merge while the new table can still be emptied by one TRUNCATE. Nearest deterministic
alternative: an integration assertion that the set of tables with a row-level refuse_change
trigger equals the set with a statement-level BEFORE TRUNCATE trigger.

- 2026-11-28 — Lane H7 (1764300009000) guarded decision_record, activity_event,
  consent_record and automation_event, and integrity.e2e-spec.ts asserts the same four by
  name. Lane B's reconciliation_run (2001) and lane C's provider_call (3001), both insert-only,
  were in other worktrees and got no TRUNCATE guard, and no test would have failed after the
  merge. Found by the data reviewer.

## data-20261128-engine-step-needs-a-version

Every piece of logic `decide()` runs must be reachable only through a version the record
stores (rule set or scorecard), or the current version must have a frozen fixture of stored
records that a test replays. Why: reproduce (ADR 0022) re-runs the stored inputs against the
stored versions *with today's code*. A step that is not keyed to a version — a mode overlay,
a post-processing pass — can change and silently alter the replay of every record made since
it shipped, while the version string on those records stays the same. Nearest deterministic
alternative: a frozen per-version fixture (as `fixtures/rs-pl-1-records.json` does for RS-PL-1)
for the current version, captured when it ships.

- 2026-11-28 — Lane C (automation modes, RS-PL-2). `applyAutomation()` in decide.ts runs for
  any snapshot carrying `automation`, whatever the rule set; RS-PL-1 was frozen with a fixture,
  but no RS-PL-2 records (with modes, fraud, income mismatch) were frozen. Found by the data
  reviewer.
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
