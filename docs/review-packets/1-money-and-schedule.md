# Review packet 1 — Money, interest and the repayment schedule

For you to check by hand (about 15 minutes). The loop kept going; anything you correct here
goes through `/lesson` and into the AI-evidence log as a human review.

## What was built

- `Money` (packages/core/src/money/money.ts): decimal.js underneath, never a JS number.
  Parses only decimal strings, multiplies by rates given as strings, divides only by whole
  counts, rounds only when told how, refuses to serialise an unrounded value or one that
  does not fit `numeric(14,2)`.
- The schedule (apps/api/src/adapters/simulated/core-banking/schedule.ts), owned by the
  simulated core banking system because the PRD says core owns schedules (ADR 0019 R7):
  - interest = principal × monthly rate × months, rounded half-up once;
  - each instalment = total ÷ months, truncated to the centavo; the last absorbs the rest;
  - principal part the same way; interest part = instalment − principal part.
- Lending refuses a booking whose schedule does not add up, whatever core says
  (`assertReconciles`, packages/base/src/cases/booking.service.ts).

## How it was tested

- 37 Money tests (packages/core/test/money.test.ts), including the 12-digit column limit.
- 327 schedule tests (schedule.spec.ts), of which a 315-case grid — 7 amounts × the 5 grade rates
  (A–E, 1.20%–2.00%) × 9 tenors — checks
  Σ instalments = principal + interest, Σ principal parts = principal, Σ interest parts =
  interest, and that the last instalment is never below the others.
- Integration: F1 and F2 schedules end to end, and B-8 compares every disbursed case's
  approved amount, account, schedule total and disbursement in SQL.

## What the reviewers found (and what changed)

- data: the parse limit allowed 13 whole digits but the column holds 12 → fixed, tested.
- qa: `minus`, rate-string refusals and negative rounding were untested → tests added.
- data: "floor" in the ADR vs `DOWN` in code → documented as truncation on non-negatives.

## Check these three by hand

1. F2's numbers: ₱120,000 at 1.60% a month for 36 months. Interest should be ₱69,120.00,
   total ₱189,120.00, regular instalment ₱5,253.33 and the last ₱5,253.45
   (189,120.00 − 35 × 5,253.33). Does the rounding rule read right to you?
2. Is "last instalment absorbs the remainder" the rule you want to defend, or would you
   rather spread centavos over the first instalments? (ADR 0019 R4)
3. Add-on interest is the prototype's method. Would WhiteBank expect diminishing balance?
   (A change is one function plus its tests.)
