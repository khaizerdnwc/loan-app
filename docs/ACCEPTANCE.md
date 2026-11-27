# Acceptance criteria

Every criterion names the test that proves it (`check:acceptance-has-test` keeps the test
column honest once tests exist). Format: GIVEN / WHEN / THEN. Status: ☐ not built, ☑ passing.

## F1 — Auto-approved loan (Maria Santos, ₱150,000 / 24 months)

| ID | Criterion | Test | Status |
|---|---|---|---|
| F1-1 | GIVEN Maria (age 31, full bureau file 748, verified income ₱78,000) WHEN the loan officer submits ₱150,000 over 24 months THEN the decision is Auto-approve, score 742, grade A, no referral trigger | — | ☐ |
| F1-2 | GIVEN that decision THEN a decision record stores the inputs snapshot, rule set and scorecard versions, rule results, score, outcome and provider mode, and reproducing it returns `match` | — | ☐ |
| F1-3 | GIVEN an auto-approved case WHEN loan operations simulates the borrower's e-signature THEN the case moves to Booking | — | ☐ |
| F1-4 | GIVEN a case in Booking WHEN loan operations submits it and a different supervisor approves THEN a loan account, a 24-line schedule and one disbursement exist, the case is Disbursed, and Σ instalments = principal + interest exactly | — | ☐ |
| F1-5 | GIVEN any of the above steps THEN the activity history shows who did it, what changed and when | — | ☐ |

## F2 — Referred thin-file loan with counter-offer (Joel Reyes, ₱200,000 / 36 months)

| ID | Criterion | Test | Status |
|---|---|---|---|
| F2-1 | GIVEN Joel (age 27, thin bureau file, new to bank) WHEN the officer submits ₱200,000 / 36 THEN the decision is Refer, score 612, grade C, with reason codes for thin file and score in the referral band | — | ☐ |
| F2-2 | GIVEN a referred case WHEN the officer opens it THEN the case view shows applicant data, every rule result, score, grade, reason codes and the referral trigger | — | ☐ |
| F2-3 | GIVEN the referred case WHEN the officer recommends a counter-offer of ₱120,000 / 36 without a reason code THEN it is refused with a readable error | — | ☐ |
| F2-4 | GIVEN the referred case WHEN the officer recommends ₱120,000 / 36 with a reason code and rationale THEN the case moves to Approval and the override is recorded | — | ☐ |
| F2-5 | GIVEN the recommendation WHEN Rina (₱1,000,000, grades A–C) approves THEN the case moves to Offer with the counter-offer terms | — | ☐ |
| F2-6 | GIVEN the approved case THEN e-signature, booking (maker) and approval (checker) produce an account, a 36-line reconciled schedule and a disbursement of ₱120,000 | — | ☐ |

## Roles, segregation of duties and authority

| ID | Criterion | Test | Status |
|---|---|---|---|
| R-1 | A loan officer calling the approve endpoint gets 403, and the case does not change | — | ☐ |
| R-2 | An approver calling the booking endpoints gets 403 | — | ☐ |
| R-3 | A request with no session gets 401 on every non-public endpoint | — | ☐ |
| R-4 | The officer who made a recommendation cannot approve it (403, maker-checker) | — | ☐ |
| R-5 | The loan operations user who submitted a booking cannot approve it (403, maker-checker) | — | ☐ |
| R-6 | Ben (₱100,000, grades A–B) approving a ₱120,000 grade C case gets 403 naming the limit; the case is flagged escalated and stays in Approval; Rina can then approve it | — | ☐ |
| R-7 | Compliance can read every case and history but every write returns 403 | — | ☐ |

## Application capture and validation

| ID | Criterion | Test | Status |
|---|---|---|---|
| A-1 | An amount below ₱20,000 or above ₱500,000 is rejected with a field error; nothing is stored | — | ☐ |
| A-2 | A tenor outside 6–36 months, or not a whole number, is rejected | — | ☐ |
| A-3 | A missing applicant, amount, tenor or purpose is rejected | — | ☐ |
| A-4 | A saved draft and a submitted case read back identically after a reload | — | ☐ |

## Decision rules

| ID | Criterion | Test | Status |
|---|---|---|---|
| D-1 | Age 20 or 66 → Auto-decline with the age knockout reason, and no score | `packages/base/test/decisioning/decide.test.ts` | ☑ |
| D-2 | Sanctions match → Auto-decline (Ramon Cruz), no score | `packages/base/test/decisioning/decide.test.ts` | ☑ |
| D-3 | Existing default → Auto-decline | `packages/base/test/decisioning/decide.test.ts` | ☑ |
| D-4 | Score below 600 with no knockout and no referral trigger → Auto-decline with reason codes | `packages/base/test/decisioning/decide.test.ts` | ☑ |
| D-5 | DTI above 40% → Refer with the DTI reason (Nico Villareal) | `packages/base/test/decisioning/decide.test.ts` | ☑ |
| D-6 | Amount above ₱300,000 with a good score → Refer with the auto-limit reason (Rafael Gomez) | `packages/base/test/decisioning/decide.test.ts` | ☑ |
| D-7 | Every decline and referral carries at least one readable reason code | `packages/base/test/decisioning/decide.test.ts` | ☑ |
| D-9 | A referral trigger refers the case even in the decline band, and the low score is shown as a reason (R07) | `packages/base/test/decisioning/decide.test.ts` | ☑ |
| D-8 | The same inputs and versions always give the same result | `packages/base/test/decisioning/decide.test.ts` | ☑ |

## Booking integrity and failure handling

| ID | Criterion | Test | Status |
|---|---|---|---|
| B-1 | Submitting a booking twice returns the same booking request (one key) | — | ☐ |
| B-2 | Approving the same booking twice, in sequence, creates exactly one account and one disbursement; the second call is refused or returns the first result | — | ☐ |
| B-3 | Two concurrent approvals create exactly one account and one disbursement | — | ☐ |
| B-4 | For every amount/tenor/grade combination in a grid, Σ instalments = principal + interest, Σ principal = principal, Σ interest = interest | — | ☐ |
| B-5 | A core banking timeout during booking leaves the case in Booking failed with the error; a retry with the same key books exactly once | — | ☐ |
| B-6 | When core created the account but the reply was lost, the retry returns that same account (no second account) | — | ☐ |
| B-7 | With the bureau in outage, a submission is referred with "bureau unavailable", never declined | — | ☐ |
| B-8 | Case status, decision record, loan account, schedule and disbursement agree for every disbursed case | — | ☐ |

## Deferred (explicitly out of this release)

Borrower app and borrower-side acceptance; information requests and document upload; OCR
and statement analysis; credit memo; credit committee and voting; collateral and home
loans; collections; configuration screens (products, rules, bands); SLA timers and
notifications; MFA/SSO; multi-tenancy; sandbox/live provider modes; real AML list
screening; fees and disclosure statement (stretch).
