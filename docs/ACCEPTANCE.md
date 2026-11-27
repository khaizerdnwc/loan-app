# Acceptance criteria

Every criterion names the test that proves it (`check:acceptance-has-test` keeps the test
column honest once tests exist). Format: GIVEN / WHEN / THEN. Status: ☐ not built, ☑ passing.

## F1 — Auto-approved loan (Maria Santos, ₱150,000 / 24 months)

| ID | Criterion | Test | Status |
|---|---|---|---|
| F1-1 | GIVEN Maria (age 31, full bureau file 748, verified income ₱78,000) WHEN the loan officer submits ₱150,000 over 24 months THEN the decision is Auto-approve, score 742, grade A, no referral trigger | `apps/api/test/journeys.e2e-spec.ts` + browser: `apps/backoffice/e2e/f1.spec.ts` | ☑ |
| F1-2 | GIVEN that decision THEN a decision record stores the inputs snapshot, rule set and scorecard versions, rule results, score, outcome and provider mode, and reproducing it returns `match` | `apps/api/test/journeys.e2e-spec.ts` + browser: `apps/backoffice/e2e/f1.spec.ts` | ☑ |
| F1-3 | GIVEN an auto-approved case WHEN loan operations simulates the borrower's e-signature THEN the case moves to Booking | `apps/api/test/journeys.e2e-spec.ts` + browser: `apps/backoffice/e2e/f1.spec.ts` | ☑ |
| F1-4 | GIVEN a case in Booking WHEN loan operations submits it and a different supervisor approves THEN a loan account, a 24-line schedule and one disbursement exist, the case is Disbursed, and Σ instalments = principal + interest exactly | `apps/api/test/journeys.e2e-spec.ts` + browser: `apps/backoffice/e2e/f1.spec.ts` | ☑ |
| F1-5 | GIVEN any of the above steps THEN the activity history shows who did it, what changed and when | `apps/api/test/journeys.e2e-spec.ts` + browser: `apps/backoffice/e2e/f1.spec.ts` | ☑ |

## F2 — Referred thin-file loan with counter-offer (Joel Reyes, ₱200,000 / 36 months)

| ID | Criterion | Test | Status |
|---|---|---|---|
| F2-1 | GIVEN Joel (age 27, thin bureau file, new to bank) WHEN the officer submits ₱200,000 / 36 THEN the decision is Refer, score 612, grade C, with reason codes for thin file and score in the referral band | `apps/api/test/journeys.e2e-spec.ts` + browser: `apps/backoffice/e2e/f2.spec.ts` | ☑ |
| F2-2 | GIVEN a referred case WHEN the officer opens it THEN the case view shows applicant data, every rule result, score, grade, reason codes and the referral trigger | `apps/api/test/journeys.e2e-spec.ts` + browser: `apps/backoffice/e2e/f2.spec.ts` | ☑ |
| F2-3 | GIVEN the referred case WHEN the officer recommends a counter-offer of ₱120,000 / 36 without a reason code THEN it is refused with a readable error | `apps/api/test/journeys.e2e-spec.ts` + browser: `apps/backoffice/e2e/f2.spec.ts` | ☑ |
| F2-4 | GIVEN the referred case WHEN the officer recommends ₱120,000 / 36 with a reason code and rationale THEN the case moves to Approval and the override is recorded | `apps/api/test/journeys.e2e-spec.ts` + browser: `apps/backoffice/e2e/f2.spec.ts` | ☑ |
| F2-5 | GIVEN the recommendation WHEN Rina (₱1,000,000, grades A–C) approves THEN the case moves to Offer with the counter-offer terms | `apps/api/test/journeys.e2e-spec.ts` + browser: `apps/backoffice/e2e/f2.spec.ts` | ☑ |
| F2-6 | GIVEN the approved case THEN e-signature, booking (maker) and approval (checker) produce an account, a 36-line reconciled schedule and a disbursement of ₱120,000 | `apps/api/test/journeys.e2e-spec.ts` + browser: `apps/backoffice/e2e/f2.spec.ts` | ☑ |

## Roles, segregation of duties and authority

| ID | Criterion | Test | Status |
|---|---|---|---|
| R-1 | A loan officer calling the approve endpoint gets 403, and the case does not change | `apps/api/test/access-and-validation.e2e-spec.ts` | ☑ |
| R-2 | An approver calling the booking endpoints gets 403 | `apps/api/test/access-and-validation.e2e-spec.ts` | ☑ |
| R-3 | A request with no session gets 401 on every non-public endpoint (the global guard fails closed; the test samples reads, writes and admin routes) | `apps/api/test/access-and-validation.e2e-spec.ts` | ☑ |
| R-4 | The officer who made a recommendation cannot approve it (role segregation: approve is approver-only; the same-user check in CasesService.approve is defence in depth) | `apps/api/test/access-and-validation.e2e-spec.ts` (R-1) | ☑ |
| R-5 | The loan operations user who submitted a booking cannot approve it (403, maker-checker) | `apps/api/test/access-and-validation.e2e-spec.ts` | ☑ |
| R-6 | Ben (₱100,000, grades A–B) approving a ₱120,000 grade C case gets 403 naming the limit; the case is flagged escalated and stays in Approval; Rina can then approve it | `apps/api/test/access-and-validation.e2e-spec.ts` + browser: `apps/backoffice/e2e/f2.spec.ts` | ☑ |
| R-7 | Compliance can read every case and history but every write returns 403 (all 12 write routes) | `apps/api/test/access-and-validation.e2e-spec.ts` | ☑ |
| R-8 | An approver can decline (with a reason code) or return a case; each writes its event; the officer and compliance get 403; a recommendation to decline cannot be approved (409); returning an escalated case clears the escalation and records it | `apps/api/test/approval-and-session.e2e-spec.ts` | ☑ |
| R-9 | Role and identity are re-read from the staff table on every request: a token for a removed staff id gets 401, and a changed role loses the old role's access at once | `apps/api/test/approval-and-session.e2e-spec.ts` | ☑ |
| R-10 | Staff sign in with a seeded username and the test password; a wrong password and an unknown user get the same 401 and no cookie; there is no password-less route and no public list of accounts; passwords are stored only as scrypt hashes and never returned | `apps/api/test/approval-and-session.e2e-spec.ts`, `packages/base/test/auth-password.test.ts`, `apps/backoffice/test/sign-in.test.tsx` + browser: `apps/backoffice/e2e/sign-in.spec.ts` | ☑ |

## Application capture and validation

| ID | Criterion | Test | Status |
|---|---|---|---|
| A-1 | An amount below ₱20,000 or above ₱500,000 is rejected with a field error; nothing is stored | `apps/api/test/access-and-validation.e2e-spec.ts` | ☑ |
| A-2 | A tenor outside 6–36 months, or not a whole number, is rejected | `apps/api/test/access-and-validation.e2e-spec.ts` | ☑ |
| A-3 | A missing applicant, amount, tenor or purpose is rejected | `apps/api/test/access-and-validation.e2e-spec.ts` | ☑ |
| A-4 | A saved draft and a submitted case read back identically after a reload | `apps/api/test/access-and-validation.e2e-spec.ts` | ☑ |
| A-5 | A draft edited while its decision inputs are being gathered is refused (409), never decided on stale terms | `apps/api/test/approval-and-session.e2e-spec.ts` | ☑ |
| A-6 | A malformed JSON body gets a 400 problem body | `apps/api/test/approval-and-session.e2e-spec.ts` | ☑ |
| A-7 | One open application per applicant and product: a second capture is refused (409 `DUPLICATE_APPLICATION`, naming the open case) and nothing is stored; a declined or disbursed application does not block a new one; the form shows the API's message naming the open case; two captures at once make exactly one (partial unique index) | `apps/api/test/approval-and-session.e2e-spec.ts` | ☑ |
| C-1 | No consent, no bureau check (PRD INT-006, AIS-002): a draft cannot be submitted until the applicant's consent to the credit bureau check and to data processing, for the current terms version, is recorded (400 on `consent`, no decision made). Consent is recorded at capture or on the draft, with the channel, who captured it and when; a correction is a new insert-only record and the latest applies (re-read under the lock, so consent withdrawn mid-submit stops the decision); capture-and-submit without full consent stores nothing; re-deciding also needs it; SUBMIT is offered disabled with the reason until consent is complete; the case shows it and a draft's consent can be recorded there | `apps/api/test/approval-and-session.e2e-spec.ts`, `packages/base/test/cases/consent.test.ts` + component: `apps/backoffice/test/consent-panel.test.tsx` + browser: `apps/backoffice/e2e/consent.spec.ts` | ☑ |

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
| B-1 | Submitting a booking twice returns the same booking request (one key) | `apps/api/test/booking-and-failures.e2e-spec.ts` | ☑ |
| B-2 | Approving the same booking twice, in sequence, creates exactly one account and one disbursement; the second call is refused or returns the first result | `apps/api/test/booking-and-failures.e2e-spec.ts` | ☑ |
| B-3 | Two concurrent approvals create exactly one account and one disbursement | `apps/api/test/booking-and-failures.e2e-spec.ts` | ☑ |
| B-4 | For every amount/tenor/grade combination in a grid, Σ instalments = principal + interest, Σ principal = principal, Σ interest = interest | `apps/api/src/adapters/simulated/core-banking/schedule.spec.ts` (315-case grid) | ☑ |
| B-5 | A core banking timeout during booking leaves the case in Booking failed with the error; a retry with the same key books exactly once | `apps/api/test/booking-and-failures.e2e-spec.ts` + browser: `apps/backoffice/e2e/failures.spec.ts` | ☑ |
| B-6 | When core created the account but the reply was lost, the retry returns that same account (no second account) | `apps/api/test/booking-and-failures.e2e-spec.ts` | ☑ |
| B-7 | With the bureau in outage, a submission is referred with "bureau unavailable", never declined | `apps/api/test/booking-and-failures.e2e-spec.ts` + browser: `apps/backoffice/e2e/failures.spec.ts` | ☑ |
| B-8 | Case status, decision record, loan account, schedule and disbursement agree for every disbursed case (a missing record fails it) | `apps/api/test/booking-and-failures.e2e-spec.ts` | ☑ |
| B-9 | Booking refuses a schedule that does not reconcile (one centavo off, wrong principal, wrong count, wrong total) | `packages/base/test/cases/assert-reconciles.test.ts` | ☑ |
| B-10 | A case referred because a provider was down is re-decided by the loan officer once it answers (bureau or screening outage): the inputs are gathered again, a second decision record is made (the first stays and still reproduces), the case moves to the new outcome, and the earlier recommendation and approver are cleared (kept in the event). While the provider is still down it answers 503 and writes nothing; outside REVIEW, or for a case decided with every provider answering, 409 and nothing written; two at once make one record; other roles get 403. A case decided during an outage cannot be recommended for approval (only for decline), nor approved however it reached APPROVAL | `apps/api/test/booking-and-failures.e2e-spec.ts`, `packages/base/test/cases/lifecycle.test.ts` + component: `apps/backoffice/test/actions-panel.test.tsx` | ☑ |
| W-1 | GIVEN a case in DRAFT, REVIEW, APPROVAL or OFFER WHEN the loan officer withdraws it with a reason code (Applicant withdrew, Duplicate application, Not proceeding) and an optional note THEN it is Withdrawn, the reason, note, who and when are shown on the case, and a WITHDRAWN event records the from-status, in one transaction. From BOOKING or later (or a closed status) it is refused with 409 and nothing changes; a missing or unknown reason gets 400; every other role gets 403; the applicant can then capture a new application (INT-007) | `apps/api/test/withdraw-and-expiry.e2e-spec.ts`, `packages/base/test/cases/lifecycle.test.ts` + component: `apps/backoffice/test/actions-panel.test.tsx`, `apps/backoffice/test/outcome-banner.test.tsx`, `packages/ui/test/components.test.tsx` + browser: `apps/backoffice/e2e/withdraw.spec.ts` | ☑ |
| W-2 | GIVEN a draft unchanged for 30 days (PRD INT-003) or an offer unsigned 5 days after it was made THEN editing (even consent only), submitting or signing it is refused with 409 naming the expiry date and nothing changes, the case shows when it expires while open, and the scheduled sweep (`EXPIRY_SWEEP_SECONDS`) moves it to Expired with a SYSTEM event, one case per transaction under a row lock; younger cases and every other status are untouched; a second (or concurrent) sweep changes nothing more; an expired application frees the applicant for a new one | `apps/api/test/withdraw-and-expiry.e2e-spec.ts`, `apps/api/src/expiry-sweep.spec.ts`, `packages/base/test/cases/lifecycle.test.ts` + component: `apps/backoffice/test/actions-panel.test.tsx` | ☑ |
| L-1 | A case's status changes only along the transition table's edges, checked at both ends | `packages/base/test/cases/lifecycle.test.ts` + lint `house/no-case-status-assignment-outside-lifecycle` | ☑ |

## Hardening

| ID | Criterion | Test | Status |
|---|---|---|---|
| H-1 | Swagger (`/docs`, `/docs-json`) is an explicit opt-in: served only when `SWAGGER_ENABLED=true`; unset, blank or `false` (whatever `NODE_ENV` is) both answer 404; any other value stops the API at boot | `apps/api/test/hardening.e2e-spec.ts`, `apps/api/src/config/env.spec.ts` | ☑ |
| H-2 | The backoffice `/api` proxy refuses a request body over 100 KiB with a 413 problem body and never calls the API: a declared Content-Length over the cap or not a number is refused before reading, a streamed body is cut off at the cap. A client body that stalls past the 15-second deadline is cancelled and answered 504 with a problem body. The backoffice env module throws if loaded in a browser, and lint stops it being imported outside route handlers and middleware | `apps/backoffice/test/api-route.test.ts`, `apps/backoffice/test/env-server-only.test.ts` + lint `house/no-server-env-in-client` (`packages/eslint-house/test/house-rules.test.ts`) | ☑ |
| H-3 | The default rate limit is per signed-in staff member (300 a minute per route): one user's 301st request gets 429 while another user from the same address is served. Requests with no token or an unverifiable one count against the address, so forged tokens buy no fresh bucket and do not lock out signed-in staff. Sign-in stays per address even when the caller holds a session | `apps/api/test/hardening.e2e-spec.ts` | ☑ |

## Deferred (explicitly out of this release)

Borrower app and borrower-side acceptance; information requests and document upload; OCR
and statement analysis; credit memo; credit committee and voting; collateral and home
loans; collections; configuration screens (products, rules, bands); SLA timers and
notifications; MFA/SSO; multi-tenancy; sandbox/live provider modes; real AML list
screening; fees and disclosure statement (stretch).
