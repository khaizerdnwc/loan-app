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
  (`SELECT … FOR UPDATE`), re-checks the state is `PENDING_CHECKER`, checks the checker is a
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
- **R6. Disbursement** is part of the same step in this MVP (unsecured personal loan, single
  tranche), keyed by the same booking key.

## Concurrency limitations (documented)
- Correctness rests on Postgres row locks and unique constraints; a multi-region active-active
  database would need a different design.
- The simulated core and lending share one Postgres instance but use separate schemas and
  separate transactions. A crash between the core call and the lending commit leaves an
  account in core with no lending record; R5's retry reconciles it. There is no background
  reconciliation job.

## Consequences
Duplicates are prevented at three layers. Cost: a row lock per booking, which is negligible
at the PRD's volume. Tested sequentially (replay) and concurrently (two simultaneous approvals).
