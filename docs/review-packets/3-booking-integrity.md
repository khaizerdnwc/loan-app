# Review packet 3 — Booking, duplicates and safe retry

For you to check by hand (about 20 minutes). This is the part the panel is most likely to
trace live ("duplicate booking protection through UI, backend, data and tests").

## What was built (ADR 0020)

1. Maker (`POST /cases/:id/booking`): one booking request per case, `UNIQUE(case_id)`, with
   a server-generated key `bk-<uuid>`. A second submit returns the same request.
2. Checker (`POST /cases/:id/booking/approve`), in ONE transaction:
   lock the case row (`SELECT … FOR UPDATE`) → re-check the status → check checker ≠ maker
   → core banking `bookLoan(key)` → check the schedule reconciles → `disburse(key)` →
   insert account + schedule + disbursement → booking BOOKED → case DISBURSED → activity.
3. Database constraints back it up: `UNIQUE(loan_account.case_id)`,
   `UNIQUE(loan_account.core_account_number)`, `UNIQUE(disbursement.loan_account_id)`,
   `UNIQUE(disbursement.idempotency_key)`.
4. The simulated core and payments rail are idempotent on the key and keep their state in
   their own schema and own statements (`sim.*`), so a lending rollback does not undo what
   "core" did — like a real core system.
5. Failure: any provider failure rolls the booking back, then marks it FAILED (attempts,
   error code and a staff sentence) in a second transaction. Retry = the same endpoint with
   the same key.

## How it was tested (apps/api/test/booking-and-failures.e2e-spec.ts)

- B-1 double submit → one request. B-2 approve twice → second 409, one of everything.
- B-3 three checker calls at once on each of five cases → per case exactly one 200 and two
  409s; one core account, one lending account, one disbursement, one payment. An overlap
  inside the transaction is near-certain, not guaranteed.
- B-5 core TIMEOUT → BOOKING_FAILED, RETRY offered; retry with the same key books once.
- B-6 LOST_REPLY (core created the account, the reply never arrived) → retry receives that
  same account number; still one of everything.
- Disbursement outage after core booked → retry pays once. Malformed core reply → refused.
- B-8 SQL cross-check that status, decision, account, schedule and disbursement agree.

## Check these three by hand

1. In the backoffice as Leo, set Core banking to "LOST_REPLY", approve a booking as Ella,
   see it fail, switch back to OK, retry: one account?
2. The core call happens while the case row is locked. Fine at the PRD's volume; would you
   rather book outside the lock with a "BOOKING_IN_PROGRESS" state? (ADR 0020 limitations)
3. There is no background reconciliation job: a crash between core's commit and lending's
   commit is repaired only by a retry. Is that acceptable to state as a limitation?
