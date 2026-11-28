# ADR 0020 — Idempotent booking and disbursement

## Status
Accepted (27 Nov 2026).

## Context
"Loan Operations and Finance won't accept a loan booked twice." Repeats happen: a double
click, a browser retry, a checker approving in two tabs, two checkers at once, and a core
banking call that times out after the account was created (the reply is lost, so lending
cannot tell whether it worked).

## Alternatives considered
1. **Disable the button.** Necessary for the experience, useless as a guarantee.
2. **Application status check only.** Two concurrent requests both read "pending" and both
   book.
3. **Idempotency key + database constraints + row lock + idempotent core call.** Chosen.

## Decision
- **R1. One key per booking.** When loan operations submits a booking (the maker step),
  lending creates a booking request with a server-generated idempotency key
  (`crypto.randomUUID()`), unique per application (`UNIQUE(application_id)`). A second
  submit returns the existing request.
- **R2. The checker's approval runs in one transaction** that locks the application row
  (`SELECT … FOR NO KEY UPDATE`; `FOR UPDATE` until H7, changed so foreign-key checks from
  child rows written on another connection do not wait on it — it serialises two approvals
  exactly as before), re-checks the state is `PENDING_CHECKER`, checks the checker is a
  supervisor and not the maker, calls core banking with the key, then writes the loan
  account, schedule, disbursement, status change and activity events together.
- **R3. Constraints make a duplicate impossible even if the code is wrong:**
  `UNIQUE(loan_account.application_id)`, `UNIQUE(loan_account.core_account_ref)`,
  `UNIQUE(disbursement.loan_account_id)`, `UNIQUE(disbursement.idempotency_key)`.
- **R4. Core banking is idempotent on the key.** The simulated core stores accounts by
  idempotency key in its own schema and transaction; a replay returns the same account and
  the same schedule. A real provider would be chosen (or wrapped) to honour the same key.
- **R5. Failure is safe.** A core timeout or outage moves the case to `BOOKING_FAILED` with
  the error recorded and the key kept. Retry (by a supervisor) reuses the same key: if core
  had created the account before the reply was lost, the retry receives that account.
- **R6. Disbursement** is its own port and simulated service (`Disbursement`,
  `ServiceName.Disbursement`), so it can fail and be switched like the others, and a real
  payments provider can replace it alone. In this MVP it runs in the same checker step as
  booking (unsecured personal loan, single tranche), keyed by the same booking key, and the
  disbursement record commits in the same lending transaction.

## Concurrency limitations (documented)
- Correctness rests on Postgres row locks and unique constraints; a multi-region active-active
  database would need a different design.
- The simulated core and lending share one Postgres instance but use separate schemas and
  separate transactions. A crash between the core call and the lending commit leaves an
  account in core with no lending record; R5's retry reconciles it. There is no background
  reconciliation job.
- The checker's transaction holds the case row lock and one pooled connection for the whole
  core and disbursement call, and each simulator takes a second connection. The pool is
  bounded (20 connections, 5-second acquire timeout, `dataSourceOptions`), so a burst of
  simultaneous approvals fails fast instead of waiting forever. That refusal is an
  unclassified 500 (not BOOKING_FAILED): nothing is written, the key is kept, and a retry is
  safe. Booking outside the lock with a
  BOOKING_IN_PROGRESS state would remove this; it is not needed at the PRD's volume.
- A schedule that does not reconcile is refused (`assertReconciles`), and the case is marked
  BOOKING_FAILED. A retry with the same key gets the same core account back, so the
  mismatch repeats: the case stays failed and core holds an account with no lending record.
  Lending does not check that core priced the loan at the approved rate, only that core's
  numbers add up. Both need an operations runbook and the reconciliation job (deferred).
- Child tables (schedule line, disbursement, loan account, booking request, decision record,
  activity event) carry no foreign keys yet. Each set of rows is written in one transaction
  and never deleted, so no orphan can arise from the code today. Adding the keys is the next
  data migration.

## Consequences
Duplicates are prevented at three layers. Cost: a row lock per booking, which is negligible
at the PRD's volume. Tested sequentially (replay) and concurrently (three simultaneous
approvals on each of five cases).
