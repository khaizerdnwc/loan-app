# security lessons — log

Full narratives, newest first. **Not loaded** by any skill or agent: the loaded, path-tagged
one-liners are in `lessons.md`. Read one entry with `pnpm lessons show <id>`, or every entry a
rule enforces with `pnpm lessons show house/<rule>`. A `Gate:` line means a machine enforces it.

## security-20261127-precondition-rechecked-under-the-lock

When a service checks a precondition before calling a provider outside the transaction (the
consent gate before the bureau pull in `submit`), re-check it inside the transaction after
`lockOrFail`, or make every writer of that precondition bump the case `version` the optimistic
check already compares. Why: C-1 read the latest consent before `gatherInputs` and then only
compared `c.version` under the lock; a consent-only `PATCH /cases/:id` inserts a consent record
without touching the case row, so a withdrawal that lands between the check and the commit
leaves a decision recorded on a case whose latest consent says no. Nearest gate: an integration
test that withdraws consent between the gate and the commit (a paused bureau simulator, or a
spy on `gatherInputs`) and asserts 400 or 409 and no decision record.

## security-20261127-validate-nested-declares-its-shape

Gate: house/require-shape-with-validate-nested

`@ValidateNested()` accepts an array as readily as one object (class-validator walks each
element), and without `@Type(() => X)` the nested body is never built into the DTO class, so
its whitelist has nothing to check. C-1 added the first nested DTO (`consent`) with `@Type` but
no `@IsObject()`: `consent: []` passed the pipe and reached the service as an array. It failed
closed only because the service compared `termsVersion`; the next nested field may not have a
service-side check. The rule requires `@Type` and `@IsObject()` or `@IsArray()` on the property.

## security-20261127-re-entry-clears-earlier-actors

Gate: test: apps/api/test/booking-and-failures.e2e-spec.ts ("re-deciding after a recommendation, a return and recovery clears the earlier actors")

When a transition lets a case leave a state it may have re-entered (REVIEW after RETURN), and
the new outcome is not made by a person (an automated decision), clear the actor fields an
earlier pass set (`approvedBy`, `recommendedBy`, `recommendation`, `isOverride`) or the view
names someone as the approver of a loan they never approved. Why: the PRD NFR-005 re-decide
(`POST /cases/:id/redecide`) copies `submit`, which runs from DRAFT where those fields are
always null. From REVIEW they are not: an ungraded outage case can be recommended, then
returned by an approver (`returnToReview` sets `approvedBy` to that approver); re-deciding it
to AUTO_APPROVE then shows `approved.by` = the approver who returned it, alongside a stale
recommendation, and keeps the case in that approver's list. In a segregation-of-duties record,
"who approved" must be exactly the person who did. The previous values belong in the
activity event's details, not on the case. Nearest gate: an integration test that recommends,
returns and re-decides an outage case and asserts `approved.by` is null and `recommendation`
is null.

## security-20261127-gitleaks-allowlist-literal-must-be-anchored

When `.gitleaks.toml` allowlists one published, non-secret value, write the regex anchored
(`'''^Password123!$'''`), not as a bare literal. Why: M9c published one shared test password
and allowlisted it as `'''Password123!'''`. Gitleaks' allowlist `regexes` match against the
extracted secret by default and are unanchored, so the entry also waives any real secret that
merely contains the string (`Password123!prod`, `xPassword123!y`), which is wider than "exactly
that value". The pre-existing `(your-secret-here|changeme|example|placeholder|dummy)` entry has
the same hole at a larger scale. Not made a house check yet: whether the anchored form still
matches depends on what each default detector captures as the secret (quotes, backticks),
which only a gitleaks run can confirm, and review tooling cannot run gitleaks. Nearest gate: a
`check:gitleaks-allowlist-anchored` once the security stage has confirmed the anchored forms
pass.

## security-20261127-throttle-key-needs-a-per-source-cap

When a throttler tracker folds a client-chosen value (username, email, case id) into the key,
keep a second limit keyed on the source address alone for the same route. Why: M9b keyed
`POST /auth/sign-in` on `address|username` so one account's typos would not lock out the
office behind the shared backoffice proxy address. With `@Throttle({ default: … })` overriding
the only throttler, that left no per-source bound at all: rotating the username gives a fresh
bucket every request, so one caller can drive unlimited password-spraying attempts across the
public persona list and unlimited scrypt computations (16 MiB, libuv threadpool) for unknown
usernames. The fix is a second named throttler (e.g. `signInSource`) keyed on the address with
a generous office-wide cap, alongside the per-username one. The test is a loop of distinct
usernames from one address that must eventually get 429.
