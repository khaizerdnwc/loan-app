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

## Decisioning (rule sets `RS-PL-1` and `RS-PL-2`, scorecard `SC-PL-1`)

| Item | Value | Source |
|---|---|---|
| Knockouts (run first, no score) | Age outside 21–65 · sanctions/watchlist match · existing default · identity not verified (R14) | prototype + ours (KYC) |
| Score range | 450 – 820 | prototype |
| Grades | A ≥ 740, B ≥ 700, C ≥ 600, D ≥ 560, E < 560 | prototype |
| Bands | Decline < 600 · Refer 600–699 · Approve ≥ 700 | prototype |
| Trigger vs low score | RS-PL-1 `lowScoreWithTrigger: REFER`: a referral trigger refers the case even in the decline band ("regardless of score", PRD glossary); the low score is added as a reason for the reviewer. The prototype declined first; the PRD is the brief. Knockouts still decline first. | PRD |
| Referral triggers (refer regardless of score) | Thin file or no bureau hit · DTI above 40% (or no income) · amount above auto limit · bureau unavailable (R10) · KYC/AML screening unavailable (R13) | prototype + PRD NFR-005 |
| DTI | Existing monthly obligations ÷ verified (else declared) monthly income, compared exactly (obligations > income × 0.40), never as a rounded ratio. The new instalment is left out because pricing depends on the grade, which depends on DTI; same as the prototype | ours |
| RS-PL-2 (current, 28 Nov 2026) | RS-PL-1 plus three referral triggers: declared vs verified income mismatch, related party, and the fraud check (flag or no answer). Every other value is unchanged. RS-PL-1 stays, so records decided under it replay exactly (ACCEPTANCE D-14, TR-2) | ours (ADR 0022 R4) |
| Rolling back past RS-PL-2 | Forward-only: code from before RS-PL-2 cannot replay RS-PL-2 records (it has no such version), so once one exists a deployment rolls forward, not back (ADR 0022 amendment) | ours |
| Income mismatch tolerance | Refer when the declared monthly income differs from the verified one by more than 15% of the verified figure, either way, compared exactly (the absolute difference > verified × 0.15). No separate declaration: not evaluated. A declared income with no verified income is a mismatch. The PRD gives no number | prototype (15%) |
| Declared and verified income | `applicant.monthly_income` stays "verified when available, else declared" (what DTI uses). `applicant.declared_monthly_income` holds the declaration when it was recorded apart from the verified figure; until walk-in capture (backlog #12) only seeded applicants have one | ours |
| Related party | A boolean on the applicant (a WhiteBank insider or a relative of one), set in the seed. Every such application is referred (CMP-006 "mandatory referral"); no special approval route or report yet | ours |
| Fraud check | A simulated rules-based fraud port (PRD §9.5: velocity, duplicate identity, mismatched data) answers per synthetic applicant. A flag refers (R16). No answer (outage, timeout, malformed) refers (R17), never declines, and like a bureau or screening outage the case cannot be recommended for approval until it is re-decided once the check answers | ours (PRD DEC-006, NFR-005); the prototype "continues and flags" a fraud outage, the brief asks for a referral |
| Automation mode | Per product: OFF (every application referred), SHADOW (the engine decides and records its outcome; a person decides) or LIVE (the engine's outcome moves the case). The rules and the score always run; the mode is an input in the hashed snapshot, and the record stores it with the engine's own outcome. PL starts LIVE, which is how every earlier decision ran. A product with no automation row runs OFF | PRD §7.5, AIS-007; ours (defaults) |
| Knockouts when not live | Off, in shadow or under the kill switch, every case goes to a person, knockouts included (the brief: "every application is referred"); the knockout and its reasons are shown, and such a case can only be recommended for decline. The prototype still auto-declined knockouts | ours |
| Who changes automation | Administrators (the PRD's credit risk manager configures automation; a second user approves a credit risk change, PRD §4). A mode change, and turning the kill switch off, are drafted by one administrator and take effect when a different one approves; one change waits per product. Turning the kill switch on is immediate, by one administrator with a reason ("returns all cases to manual review instantly", §7.5): it can only send cases to a person. Changes apply to new decisions (submissions and re-decisions), never to cases already decided | ours |
| Scorecard | Additive points (bureau score band, file depth, DTI, employment tenure, relationship, delinquencies); weights tuned so the PRD personas land where the PRD says (Maria 742 A, Joel 612 C) | ours |

## Seeded applicants (synthetic) and their expected outcomes

| Persona | Key inputs | Expected (engine) |
|---|---|---|
| Maria Santos (F1) | 31 · income ₱78,000 · obligations ₱9,000 · bureau 748 full · util 35% · 30 months employed · customer 18 months | Auto-approve, 742 A |
| Ana Mendoza, Liza Ramos, Grace Villanueva, Rosa Dizon | Same profile as Maria (742, A); separate synthetic applicants so the browser journeys never share one (one open application each, INT-007) | Auto-approve, 742 A |
| Teresa Lopez | Same profile as Maria, for the indicative repayment and booking checklist journey | Auto-approve, 742 A |
| Paz Ocampo | Same profile as Maria, but her deposit account is at another bank (`EXT-BANK-0042-1180`): the pre-booking checklist's disbursement account item fails | Auto-approve, 742 A; booking refused (BK-1) |
| Joel Reyes (F2) | 27 · income ₱56,000 · obligations ₱11,000 · bureau 640 thin · util 42% · 40 months employed · new to bank | Refer, 612 C (thin file, score band) |
| Ramon Cruz (F6) | 52 · sanctions match | Auto-decline, no score (R11) |
| Nico Villareal | income ₱70,000 · obligations ₱30,100 (DTI 43%) · bureau 671 full · util 45% | Refer, 602 C (DTI, score band) |
| Rafael Gomez | ₱500,000 · income ₱180,000 · bureau 711 full | Refer, grade A (amount above auto limit) |
| Carmen Diaz | bureau 540 · util 85% · 2 missed payments · 8 months employed | Auto-decline, 450 E (score, missed payments) |
| Nina Cruz | no bureau record · income ₱42,000 · 14 months employed · customer 10 months | Refer, 537 E (no bureau hit; low score shown to the reviewer) |
| Kevin Lim | age 17 | Auto-decline, no score (age) |
| Dante Flores | Maria's profile; verified income ₱50,000, declared ₱65,000 (30% above) | Refer, 742 A (income mismatch, R15) |
| Paula Mercado | Maria's profile; simulated fraud signal "duplicate identity" | Refer, 742 A (fraud flag, R16) |
| Teresa Navarro (`APL-NAVARRO`) | Maria's profile; related party (works at a WhiteBank branch) | Refer, 742 A (related party, R18) |
| Oscar Belmonte | Same profile as Maria; used only by the automation browser journey | Auto-approve live; Refer in shadow (engine outcome Auto-approve) |
| Ernesto Lacson | Same profile as Ramon (sanctions match) | Auto-decline, no score (R11); AML escalation |
| Dario Mercado | Same profile as Maria; the simulated list adds him after onboarding | Auto-approve, 742 A; screening before disbursement matches and holds the booking |

## Roles and authority

| Item | Value | Source |
|---|---|---|
| Staff roles | Loan officer · Approver · Loan operations (maker) · Loan operations supervisor (checker) · Compliance (read-only on cases; works AML escalations; reads the audit log) · Admin (simulation and automation controls and the audit log only) | PRD §4, prototype |
| Administrators | Leo Santiago and Celia Ortiz (credit risk manager), both with the Admin role, so an automation change has a drafter and a different approver. Same test password as every account | ours |
| Approver authority | Rina Aquino: ₱1,000,000, grades A–C · Ben Castro: ₱100,000, grades A–B | PRD F2 (Rina), ours (Ben, to demonstrate a breach) |
| Above authority | Blocked with the reason; the case stays in Approval, flagged escalated, visible to an approver whose authority covers it. Returning the case to the officer clears the flag (a new recommendation is a new approval request; user's decision, 27 Nov) | ours (committee deferred) |
| Override | Every recommendation needs a rationale. A counter-offer that changes the scored amount or tenor, or a recommendation to decline, is an override and also needs a reason code (OV01–OV06); approving as requested is not. The approver must be a different user. | PRD 7.4, mechanics 1c, ours (definition) |
| Booking maker-checker | Loan operations submits; a loan operations supervisor (a different user) approves, which books and disburses | PRD §4, prototype |
| One open application | An applicant may have one open application per product; open means anything but declined, disbursed, withdrawn or expired. A second capture answers 409 naming the open case. Enforced by the service and by a partial unique index, so it holds under a race | ours (PRD INT-007; prototype submit guard) |
| Withdrawal | Only the loan officer withdraws an application, from Draft, In review, Awaiting approval or Offer, with a reason code (Applicant withdrew, Duplicate application, Not proceeding (other)) and an optional note. Once the borrower has signed (Booking onwards) it cannot be withdrawn: booking and disbursement follow. Approvers decline or return instead; loan operations cannot withdraw. A withdrawn case is closed and frees the applicant for a new application | ours (PRD WF-012; prototype Withdraw reasons) |
| Expiry | A draft expires 30 days after its last change (`updated_at`; recording consent alone does not count as a change) — PRD INT-003. An offer expires 5 days after it was made (auto-approval, approval or re-decision; `offered_at`) — prototype workflow. Editing (consent included), submitting or signing an expired case is refused at once, so an edit cannot revive it; a sweep in the API (every `EXPIRY_SWEEP_SECONDS`, 300 by default) moves it to Expired. The periods are constants in `packages/core` (`DRAFT_EXPIRY_DAYS`, `OFFER_EXPIRY_DAYS`), not configuration screens (deferred). Offers already open when this shipped count from their last change | PRD INT-003, prototype, ours (sweep) |
| Consent | Staff capture the applicant's consent on their behalf at the branch (channel BRANCH_ASSISTED): consent to the credit bureau check, consent to processing under the Data Privacy Act, and the terms and conditions version (1.0 in this release). Both consents and the current version are required before the application is submitted, so the bureau is never queried without consent. Records are insert-only; a correction is a new record and the latest applies. No signed consent document is stored (documents are deferred). Re-deciding an outage case also needs a complete consent; a case submitted before consent existed (only possible on a demo database from before 28 Nov 2026) has none and cannot get one, so it is declined by hand | ours (PRD INT-006, CMP-001; prototype consent card) |
| Pre-booking checklist | Four items, from the prototype's booking screen: approvals complete (approved terms on the case); documents signed (the simulated borrower e-signature of the loan agreement: there are no separate disclosure or promissory-note documents yet); KYC valid (the current decision's screening answered, identity verified, no sanctions match, and screened less than 12 months ago, `KYC_VALIDITY_MONTHS` in packages/base); disbursement account verified (the applicant's own deposit account on record is a WhiteBank account, `WB-SAV-nnnn-nnnn`; there is no live account-status lookup in simulated core). Checked when the booking is submitted (maker step) and again when the checker approves it or retries a failed booking, each time under the row lock. If core created the account but its reply was lost (LOST_REPLY) and the retry is then refused by the checklist, core keeps an open, undisbursed account under the case's booking key and lending has no loan account for it: nothing is paid out, the case stays Booking failed, and a later retry that passes reuses that account. Reversing or closing such an account is out of scope (exception handling, backlog #7). A case whose screening goes stale cannot be re-screened yet (re-screening before disbursement is backlog #6), so it stays in Booking | ours (PRD BKG-001; prototype `checklist(a)`) |
| Indicative repayment | Before a decision, quoted by core banking for the requested amount and tenor at grade C pricing (1.60% a month), as the prototype does. It is labelled indicative and simulated and is never an offer; once decided, the case shows the approved instalment instead. When core cannot answer it reads "unavailable" and nothing else depends on it | prototype (grade C), ours (PRD INT-004) |
| Sign-in | Test sign-in: each seeded staff member has a username (paolo, rina, ben, marco, ella, lito, diane, leo, celia); every account's test password is `Password123!`, stored only as a scrypt hash (docs/TEST-ACCOUNTS.md). A wrong password and an unknown user get the same 401; there is no password-less route and no public list of accounts. Sign-in allows 20 attempts a minute per account and 60 per source address. The session is a signed, httpOnly cookie. No MFA. These are published test credentials for synthetic data, not secrets; the deployed demo uses them on purpose (seeded roles, mechanics 1a) | mechanics 1a ("test sign-in … for at least three seeded roles") |

## Journey simplifications

| Item | Choice |
|---|---|
| Borrower acceptance and e-signature | Simulated by loan operations ("Simulate borrower e-signature") through the `ESignature` port; labelled simulated |
| Counter-offer | Approved counter-offer terms replace the requested terms; borrower acceptance is part of the simulated e-signature |
| Information requests, documents, OCR, credit memo, committee | Deferred (PRD flows F2 step 3–4 shortened: the officer reviews and recommends directly) |
| Disbursement | Single tranche to the applicant's (simulated) WhiteBank account, in the same step as booking |

| Ungraded referrals | A case referred because a provider was down has no score (bureau outage) or no sanctions screening (KYC/AML outage), so it must not be approved as it stands. Once the provider answers, the loan officer re-decides it (`POST /cases/:id/redecide`): the inputs are gathered again, a new insert-only decision record is made with the current versions, and its outcome moves the case as a submission would. Only a case whose current decision was made during an outage can be re-decided; while the provider is still down nothing is written (503). The new decision starts the case afresh: any earlier recommendation, approver and escalation are cleared and kept in the event. Until then the case cannot be recommended for approval (it has no score or no sanctions screening), only for decline. | ours (PRD NFR-005) |
| Where screens differ from the prototype on purpose | Screens copy the prototype (docs/ui-parity.md), except where it would break a rule of ours: amounts stacked in a column are right-aligned with tabular figures (the prototype left-aligns them); rule values and timings are in the body font (monospace is only for identifiers); the focus ring is a solid gold-700 outline, not the prototype's 40% gold glow, and the stage bar's "ahead" steps and grade tiles B–D are a shade darker, so all meet WCAG AA; amounts the API writes into sentences ("₱20000.00") are formatted when shown, so stored history reads the same as new history | ours |
| Business date | Ages, booking dates and due dates use the Philippine calendar date (UTC+8). | ours |
| Case visibility | A case outside a role's view answers 404 (not 403), so its existence is not revealed. | ours |

## Hardening

| Item | Choice | Source |
|---|---|---|
| Swagger | Served at `/docs` only when `SWAGGER_ENABLED=true` (set in local development's `.env.example`). Unset or blank is off, so a deployment that forgets the variable publishes no route map; docs/API.md is the reference | ours |
| Rate limits | 300 requests a minute per route for each signed-in staff member (keyed on the verified session token's staff id), and the same per caller address for requests with no valid session. Sign-in keeps its own limits (20 per account, 60 per address). A token signed out but not yet expired still names its staff member's bucket; it is refused by the session guard either way | ours |
| Proxy body cap | The backoffice `/api` proxy forwards request bodies up to 100 KiB, the API's own JSON body limit; larger bodies get a 413 problem body (code `VALIDATION_FAILED`). One 15-second deadline covers reading the client's body and the API's answer: a stalled client body is a 504, an API that does not answer a 502 (both code `PROVIDER_UNAVAILABLE`) | ours |
## Compliance and audit

| Item | Choice | Source |
|---|---|---|
| AML escalation | A sanctions knockout at the decision opens an escalation for Compliance in the decision's transaction (one unclosed escalation per case and stage). Compliance acknowledges it, then closes it with an outcome (false positive, or confirmed match) and notes. Closing an escalation at application does not change the decline (the decision record is insert-only). No maker-checker on closing; no export to an AML system (the prototype's "export" is not built) | ours (PRD CMP-005, F6; prototype AML escalations) |
| Screening before disbursement | The supervisor's booking approval screens the applicant again, through the same KycAml port, before core banking is called. A match books nothing, marks the booking failed (held) and opens a pre-disbursement escalation in one transaction; a retry is refused while it is open or after a confirmed match. A false positive clears that same match (same list) for this case, so the retry books. Screening unavailable holds the booking for a retry (503), never declines. The case stays in Booking failed after a confirmed match: withdrawal (PRD WF-012) covers only Draft to Offer, so there is no closing edge from Booking failed yet | ours (PRD CMP-005, NFR-005) |
| Simulated later listing | Dario Mercado is clear at application and matched before disbursement ("Simulated watchlist (updated list)"): the simulator reads `listedBeforeDisbursement` from his persona profile when the port is called with stage PRE_DISBURSEMENT. Ernesto Lacson has Ramon's profile, for the browser journey | ours |
| Audit log scope | Sign-ins (success, failure, sign-out), simulation mode changes and every case activity event (so consent records, decisions, approvals, bookings and AML escalation work) in one hash chain. Throttled sign-in attempts (429) never reach the handler and are not logged. The chain starts empty at migration 1764300002000; earlier activity stays in the case histories | ours (PRD PLT-004) |
| Audit log contents | Never a password or token. A failed sign-in for a name that matches no account is logged as "Unknown username" without the typed text, in case a password was typed into the username box | ours (AGENTS §2.8) |
| Tamper evidence | Each entry stores sha256(previous hash + canonical JSON of the entry, keys sorted); seq is previous + 1 under a transaction-scoped advisory lock, so concurrent writers queue and there are no gaps. Triggers refuse UPDATE, DELETE and TRUNCATE. Verification recomputes from entry 1. A database owner who disables the triggers and rewrites every later hash is not detected (there is no external anchor of the head hash) | ours (PRD CMP-010) |
| Simulation changes in the log | The mode is switched in the simulators' schema first and logged after it succeeds (two transactions), so the log never shows a change that did not happen; a crash between the two would leave a change unlogged. The "from" mode is read before the switch, outside a lock, so two administrators switching the same service at once could log a wrong "from" | ours (accepted gap) |
| Who reads the log | Compliance and the administrator. The administrator cannot open cases, so on a case entry they see who did what and when, but not which case (no case id or reference), nor its summary or details; searching by case is Compliance only (403 for the administrator). So the log cannot tell the administrator which cases carry an AML review | ours (prototype: audit log for compliance and admin) |
| Audit lock and failures | Every audit entry takes one transaction-scoped advisory lock (the chain has one head), so audited writers queue behind each other for the rest of their transaction, sign-ins included. If the audit insert fails, the action fails with it: a sign-in answers 500 rather than signing in unlogged. Throttling (20 a minute per account, 60 per address) bounds the sign-in load on the lock | ours (known limit) |
| AML findings and the case history | The case history (read by loan officers and operations) says only that an AML review opened, was acknowledged, or closed with the booking released or blocked (or "the decline stands"). The list that matched, Compliance's outcome and notes go to the escalation and the audit log only, and the checker's 409 says only "screening matched; held for Compliance" (no tipping-off) | ours (security review) |
| Four-eyes on clearing a match | One Compliance user acknowledges and closes an escalation, and a false positive releases the held booking, with no second Compliance approver: there is one Compliance persona. A real deployment would put maker-checker on closing a pre-disbursement match | ours (open question for the user) |
| A match after a lost reply | When the screening on a retry matches after an earlier attempt failed, that earlier attempt may have reached core banking (lost reply, ADR 0020). The refusal says so instead of "nothing was booked", and the escalation stores the number of earlier attempts so Compliance knows the account and payout may already exist in core under the same key. If another supervisor booked the case meanwhile, the match is written to the audit log (PRE_DISBURSEMENT_MATCH_AFTER_BOOKING) and the call answers 409 | ours (data review) |
| Audit date filters | From and to are Philippine business dates (UTC+8), inclusive | ours |

Add a row whenever the build makes a choice the materials do not dictate.
