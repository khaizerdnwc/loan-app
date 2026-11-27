# Assumptions

Where the PRD excerpt and the challenge mechanics are silent, these are the choices made,
where each came from, and what would change it. Values marked *prototype* are taken from the
project team's prototype; values marked *ours* are our own.

## Product (personal loan `PL`, version 1)

| Item | Value | Source |
|---|---|---|
| Amount | ₱20,000 – ₱500,000 | prototype |
| Tenor | 6 – 36 months, whole months | prototype |
| Auto-approval limit | ₱300,000 (above it: referral) | prototype |
| Pricing | Add-on monthly rate by grade: A 1.20%, B 1.40%, C 1.60%, D 1.80%, E 2.00% | prototype |
| Interest and rounding | ADR 0019: interest rounded half-up once; instalments floored, last absorbs remainder | ours |
| Fees | None in this MVP (the prototype's 2% processing fee is deferred) | ours |
| First due date | One month after booking, same day of month (clamped to month end) | ours |

## Decisioning (rule set `RS-PL-1`, scorecard `SC-PL-1`)

| Item | Value | Source |
|---|---|---|
| Knockouts (run first, no score) | Age outside 21–65 · sanctions/watchlist match · existing default | prototype |
| Score range | 450 – 820 | prototype |
| Grades | A ≥ 740, B ≥ 700, C ≥ 600, D ≥ 560, E < 560 | prototype |
| Bands | Decline < 600 · Refer 600–699 · Approve ≥ 700 | prototype |
| Referral triggers (refer regardless of score) | Thin bureau file · DTI above 40% · amount above auto limit · bureau unavailable | prototype + PRD NFR-005 |
| DTI | Existing monthly obligations ÷ verified (else declared) monthly income. The new instalment is left out because pricing depends on the grade, which depends on DTI; same as the prototype | ours |
| Scorecard | Additive points (bureau score band, file depth, DTI, employment tenure, relationship, delinquencies); weights tuned so the PRD personas land where the PRD says (Maria 742 A, Joel 612 C) | ours |

## Roles and authority

| Item | Value | Source |
|---|---|---|
| Staff roles | Loan officer · Approver · Loan operations (maker) · Loan operations supervisor (checker) · Compliance (read-only) · Admin (simulation controls only) | PRD §4, prototype |
| Approver authority | Rina Aquino: ₱1,000,000, grades A–C · Ben Castro: ₱100,000, grades A–B | PRD F2 (Rina), ours (Ben, to demonstrate a breach) |
| Above authority | Blocked with the reason; the case stays in Approval, flagged escalated, visible to an approver whose authority covers it | ours (committee deferred) |
| Override | A recommendation that differs from the automated outcome or terms needs a reason code and rationale; the approver must be a different user | PRD 7.4, mechanics 1c |
| Booking maker-checker | Loan operations submits; a loan operations supervisor (a different user) approves, which books and disburses | PRD §4, prototype |
| Sign-in | Demo persona picker issuing a signed, httpOnly session cookie; no passwords or MFA | mechanics 1a ("test sign-in or equivalent") |

## Journey simplifications

| Item | Choice |
|---|---|
| Borrower acceptance and e-signature | Simulated by loan operations ("Simulate borrower e-signature") through the `ESignature` port; labelled simulated |
| Counter-offer | Approved counter-offer terms replace the requested terms; borrower acceptance is part of the simulated e-signature |
| Information requests, documents, OCR, credit memo, committee | Deferred (PRD flows F2 step 3–4 shortened: the officer reviews and recommends directly) |
| Disbursement | Single tranche to the applicant's (simulated) WhiteBank account, in the same step as booking |

Add a row whenever the build makes a choice the materials do not dictate.
