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
| Knockouts (run first, no score) | Age outside 21–65 · sanctions/watchlist match · existing default · identity not verified (R14) | prototype + ours (KYC) |
| Score range | 450 – 820 | prototype |
| Grades | A ≥ 740, B ≥ 700, C ≥ 600, D ≥ 560, E < 560 | prototype |
| Bands | Decline < 600 · Refer 600–699 · Approve ≥ 700 | prototype |
| Trigger vs low score | RS-PL-1 `lowScoreWithTrigger: REFER`: a referral trigger refers the case even in the decline band ("regardless of score", PRD glossary); the low score is added as a reason for the reviewer. The prototype declined first; the PRD is the brief. Knockouts still decline first. | PRD |
| Referral triggers (refer regardless of score) | Thin file or no bureau hit · DTI above 40% (or no income) · amount above auto limit · bureau unavailable (R10) · KYC/AML screening unavailable (R13) | prototype + PRD NFR-005 |
| DTI | Existing monthly obligations ÷ verified (else declared) monthly income, compared exactly (obligations > income × 0.40), never as a rounded ratio. The new instalment is left out because pricing depends on the grade, which depends on DTI; same as the prototype | ours |
| Scorecard | Additive points (bureau score band, file depth, DTI, employment tenure, relationship, delinquencies); weights tuned so the PRD personas land where the PRD says (Maria 742 A, Joel 612 C) | ours |

## Seeded applicants (synthetic) and their expected outcomes

| Persona | Key inputs | Expected (engine) |
|---|---|---|
| Maria Santos (F1) | 31 · income ₱78,000 · obligations ₱9,000 · bureau 748 full · util 35% · 30 months employed · customer 18 months | Auto-approve, 742 A |
| Joel Reyes (F2) | 27 · income ₱56,000 · obligations ₱11,000 · bureau 640 thin · util 42% · 40 months employed · new to bank | Refer, 612 C (thin file, score band) |
| Ramon Cruz (F6) | 52 · sanctions match | Auto-decline, no score (R11) |
| Nico Villareal | income ₱70,000 · obligations ₱30,100 (DTI 43%) · bureau 671 full · util 45% | Refer, 602 C (DTI, score band) |
| Rafael Gomez | ₱500,000 · income ₱180,000 · bureau 711 full | Refer, grade A (amount above auto limit) |
| Carmen Diaz | bureau 540 · util 85% · 2 missed payments · 8 months employed | Auto-decline, 450 E (score, missed payments) |
| Nina Cruz | no bureau record · income ₱42,000 · 14 months employed · customer 10 months | Refer, 537 E (no bureau hit; low score shown to the reviewer) |
| Kevin Lim | age 17 | Auto-decline, no score (age) |

## Roles and authority

| Item | Value | Source |
|---|---|---|
| Staff roles | Loan officer · Approver · Loan operations (maker) · Loan operations supervisor (checker) · Compliance (read-only) · Admin (simulation controls only) | PRD §4, prototype |
| Approver authority | Rina Aquino: ₱1,000,000, grades A–C · Ben Castro: ₱100,000, grades A–B | PRD F2 (Rina), ours (Ben, to demonstrate a breach) |
| Above authority | Blocked with the reason; the case stays in Approval, flagged escalated, visible to an approver whose authority covers it | ours (committee deferred) |
| Override | Every recommendation needs a rationale. A counter-offer that changes the scored amount or tenor, or a recommendation to decline, is an override and also needs a reason code (OV01–OV06); approving as requested is not. The approver must be a different user. | PRD 7.4, mechanics 1c, ours (definition) |
| Booking maker-checker | Loan operations submits; a loan operations supervisor (a different user) approves, which books and disburses | PRD §4, prototype |
| Sign-in | Demo persona picker issuing a signed, httpOnly session cookie; no passwords or MFA | mechanics 1a ("test sign-in or equivalent") |

## Journey simplifications

| Item | Choice |
|---|---|
| Borrower acceptance and e-signature | Simulated by loan operations ("Simulate borrower e-signature") through the `ESignature` port; labelled simulated |
| Counter-offer | Approved counter-offer terms replace the requested terms; borrower acceptance is part of the simulated e-signature |
| Information requests, documents, OCR, credit memo, committee | Deferred (PRD flows F2 step 3–4 shortened: the officer reviews and recommends directly) |
| Disbursement | Single tranche to the applicant's (simulated) WhiteBank account, in the same step as booking |

| Ungraded referrals | A case referred because the bureau was down has no score or grade; no approver's grade list covers it, so it cannot be approved until it is decided again. Re-running a decision is not in this release (recorded as a limitation). | ours |
| Business date | Ages, booking dates and due dates use the Philippine calendar date (UTC+8). | ours |
| Case visibility | A case outside a role's view answers 404 (not 403), so its existence is not revealed. | ours |

Add a row whenever the build makes a choice the materials do not dictate.
