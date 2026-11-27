# ADR 0019 — Money as exact decimals, and the schedule rounding rule

## Status
Accepted (27 Nov 2026).

## Context
Loan Operations and Finance "won't accept a centavo out of place", and the total of the
repayment schedule must reconcile to principal plus interest. JavaScript numbers are binary
floats; `0.1 + 0.2 !== 0.3`. The PRD leaves interest method and rounding to the core
banking system, and the prototype prices personal loans with an add-on monthly rate by
risk grade.

## Alternatives considered
1. **Integer centavos (`bigint`).** Exact and fast, but every rate multiplication needs a
   manual scale-and-round step, and NUMERIC columns would still be needed for reporting.
2. **Decimal type (decimal.js) wrapped in a `Money` value object, NUMERIC(14,2) in
   Postgres, strings on the wire.** Chosen.
3. Numbers rounded at the edges. Rejected: errors accumulate before the rounding step.

## Decision
- **R1.** Every amount is a `Money` (packages/core, decimal.js underneath). Arithmetic goes
  through its methods; it rounds only when asked, with an explicit mode.
- **R2.** Money columns are `numeric(14,2)` with a transformer that reads and writes strings.
  The API sends and accepts money as decimal strings (`"150000.00"`), never JSON numbers.
- **R3. Interest (add-on method).** `interest = principal × monthlyRate × tenorMonths`,
  rounded **half-up to the centavo** once, on the total.
- **R4. Instalments.** `totalRepayable = principal + interest`.
  `regularInstalment = floor_to_centavo(totalRepayable ÷ n)`; the **final instalment absorbs
  the remainder**: `totalRepayable − regularInstalment × (n − 1)`. The final instalment is
  therefore equal to or a few centavos above the others, never below.
- **R5. Principal and interest split per instalment** follows the same rule:
  `principalPortion = floor_to_centavo(principal ÷ n)`, last one absorbs the remainder;
  `interestPortion = instalment − principalPortion`.
- **R6. Reconciliation is enforced, not hoped for.** Booking is refused unless
  Σ instalments = principal + interest, Σ principal portions = principal and
  Σ interest portions = interest, exactly. Property tests cover every amount/tenor/grade
  combination in a grid.
- **R7. Ownership.** The PRD says schedules belong to core banking, so the calculation lives
  in the simulated core banking adapter (behind the `CoreBanking` port); lending stores what
  core returns and runs the R6 check on it.
- `no-float-money` (house rule) blocks number arithmetic on money-named values and float
  columns in server code.

## Consequences
No drift; one documented rule the panel can check by hand. Cost: `Money` calls are more
verbose than `+`. Reconsider if a real core banking API returns schedules with its own
rounding — then lending only verifies (R6).
