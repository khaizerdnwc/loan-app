# PRD coverage

What the WhiteBank Lending PRD (Draft v0.1, 25 Nov 2026) asks for, what this repo does today
(branch `build/mvp`), and the backlog that remains. Status was checked against the code, not
only the docs.

- **Sources.** The PRD artifact (139 requirement IDs: PC 9, INT 9, WF 12, DOC 7, COL 6, BKG 6,
  SS 8, CLX 8, RPT 7, NTF 3, PLT 6, DEC 9, AIS 12, IH 9, CMP 12, NFR 16; flows F1–F8; sections
  7.4–7.5 on review and rollout controls). The PRD does not use the ID suffixes INT-008 and
  INT-009; this file does not add them. The team prototype artifact. `docs/ACCEPTANCE.md`,
  `docs/ASSUMPTIONS.md`, `docs/BUILD-STATUS.md`, `docs/design-notes.md`, `docs/API.md`, and
  the code under `packages/base/src`, `packages/core/src`, `packages/contracts/src`,
  `apps/api/src` and `apps/backoffice/src`.
- **Scope this repo was built to.** The challenge's required capabilities, not the whole PRD:
  roles enforced on the backend, maker-checker, authority limits, capture with validation and
  persistence, knockouts, scorecard and bands, reason codes, a reproducible decision record,
  referral review with overrides, booking with exact money and a reconciled schedule,
  duplicate protection and records that agree, activity history, failure and retry, automated
  tests, and simulated services with failure modes. Every one of these is built and tested
  (ACCEPTANCE F1-*, F2-*, R-*, A-*, D-*, B-*, L-1). Most of the PRD's Phase 1 is outside that
  scope, so most rows below are not built. That is expected, and it is not a defect.
- **Status key.** *built*: the requirement's core behaviour exists and is tested.
  *partly built*: some of it exists, and the notes say what is missing. *not built*: nothing
  in the code. **OOR** means out of reach under the challenge mechanics (simulated only),
  because it needs a real external provider, a borrower mobile app, real infrastructure or
  non-synthetic data.

Summary: 14 built, 41 partly built, 84 not built (139 IDs). Of the 8 flows, 3 are partly built
(F1, F2, F6) and 5 are not built.

## 1. Coverage table

### Flows

| ID | Title | Status | Evidence | Notes |
|---|---|---|---|---|
| F1 | Auto-approved personal loan (Maria Santos) | partly built | `apps/api/test/journeys.e2e-spec.ts`, `apps/backoffice/e2e/f1.spec.ts` (F1-1..F1-5) | Score 742 A, auto-approve, reproducible record, maker-checker booking, reconciled 24-line schedule. Different from the PRD: a loan officer captures the application (the PRD has Maria apply in the app), no consent is captured, there is no core pre-fill or fraud check, and loan operations simulates the borrower's acceptance and e-signature. |
| F2 | Referred thin file with counter-offer (Joel Reyes) | partly built | journeys spec, `apps/backoffice/e2e/f2.spec.ts` (F2-1..F2-6, R-6) | Refer 612 C, override needs a reason code, counter-offer ₱120,000/36, approval within authority, booking. Missing: the request for 3 months of statements, statement analysis, and borrower acceptance in the app (simulated). ASSUMPTIONS records the shortened path. |
| F3 | Branch-assisted application with income mismatch | not built | `rs-pl-2.test.ts` (D-10), TR-1 | The income-mismatch referral trigger exists (RS-PL-2, 15%, seeded persona Dante Flores). Still missing: a branch officer role, walk-in capture of a declared income, OCR of a payslip. The capture form only offers seeded applicants. |
| F4 | Email or file intake | not built | — | No upload, OCR or batch drafts. |
| F5 | Home loan through committee | not built | — | No secured product, collateral, LTV, committee or minutes. |
| F6 | Auto-decline and compliance escalation (Ramon Cruz) | partly built | `packages/base/test/decisioning/decide.test.ts` (D-2) | The sanctions knockout declines with no score, and reason codes have borrower-safe wording (`reason-codes.ts`). Missing: escalation to Compliance (no AML escalation record or queue) and any borrower-facing decline view. |
| F7 | Delinquent loan through restructuring | not built | — | No collections module. |
| F8 | Configuration and model change | not built | AU-1..AU-3 | Rule sets are versioned in code (`rule-sets.ts`; RS-PL-2 added beside RS-PL-1, which still replays). Per-product shadow mode and kill switch are built, with maker-checker on mode changes. There is no rules editor, test harness or maker-checker publish of a rule set. |

### 6.1 Product configurator (PC)

| ID | Title | Status | Evidence | Notes |
|---|---|---|---|---|
| PC-001 | Products reference a core product | not built | `packages/base/src/cases/product.ts` | One product (`PL`) defined in code. You cannot create products. |
| PC-002 | Amount/tenor ranges, pricing grids, fees | partly built | `rule-sets.ts` (`monthlyRate` by grade), A-1/A-2 | Ranges and add-on rate by grade exist. No segment or channel grids, fees or promos; ASSUMPTIONS defers the 2% fee. |
| PC-003 | Form fields per product and channel | not built | — | The form is fixed: applicant, amount, tenor, purpose. |
| PC-004 | Document checklists per product | not built | — | |
| PC-005 | Config versioning with maker-checker | partly built | `rule-sets.ts`, `scorecards.ts` | Versions are immutable in code (RS-PL-1, SC-PL-1). No draft, review, publish or rollback, and no maker-checker. |
| PC-006 | In-flight cases keep their config version | partly built | decision record stores versions (F1-2), `decision.service.ts` reproduce | Decided cases replay on their own versions. A draft is not pinned to a version at creation, which only matters once a second version exists. |
| PC-007 | Export/import config | not built | — | |
| PC-008 | Eligibility pre-check API | not built | — | |
| PC-009 | Secured-loan attributes | not built | — | |

### 6.2 Application intake (INT)

| ID | Title | Status | Evidence | Notes |
|---|---|---|---|---|
| INT-001 | Embeddable journey for WhiteBank apps | not built (**OOR**) | — | The journey is borrower-facing (SDK, app). The staff API exists but is not a borrower API. |
| INT-002 | Pre-fill from core and KYC | partly built | `applicant.entity.ts`, `GET /applicants` | Data comes from seeded applicant rows, not from a simulated core customer lookup. |
| INT-003 | Save and resume for 30 days | partly built | A-4, A-5, W-2, `PATCH /cases/:id` | Drafts save and edit, and expire after 30 days unchanged (submit refused, then the sweep closes them as Expired). No cross-channel resume. |
| INT-004 | Loan calculator, indicative offer | partly built | IR-1, `GET /products/PL/quote`, `CaseDetail.indicativeRepayment` | Indicative monthly repayment on New application and on an undecided draft, quoted by simulated core at grade C pricing; "unavailable" when core is down. Missing: a borrower-facing calculator and a personalised indicative offer (it uses one fixed grade, not a pre-score). |
| INT-005 | Staff-assisted intake, including walk-ins | partly built | `apps/backoffice/src/app/(staff)/cases/new/page.tsx` | A loan officer captures for a seeded applicant. You cannot capture a new or walk-in customer (name, age, employer, income). There is no branch officer role. |
| INT-006 | Consent with timestamp, terms version, channel | built | C-1 | Insert-only consent records (bureau check, data processing, terms version, channel, who, when); submit and so the bureau pull refused without them. |
| INT-007 | Duplicate application detection | built | A-7 | One open application per applicant and product (service 409 + partial unique index). Booking idempotency (B-1..B-3, B-6) is separate. |
| INT-010 | Email/file intake with OCR | not built | — | |
| INT-011 | Lead capture, pre-approved offers | not built | — | |

### 6.3 Workflow and case management (WF)

| ID | Title | Status | Evidence | Notes |
|---|---|---|---|---|
| WF-001 | Configurable stages per product | partly built | `packages/base/src/cases/lifecycle.ts`, L-1 | One fixed transition table, enforced at both ends. It is not configurable, and there is no "closed" stage. |
| WF-002 | Work queues by role/branch/product/priority | partly built | `GET /cases?view=queue`, `queue-body.tsx` | There is a queue per role, and the approver queue is filtered by authority. No branch, product or priority routing, round robin, pick or reassign. |
| WF-003 | SLA timers and escalation | not built | — | `queue-body.tsx` states that no SLA figures are shown. |
| WF-004 | Approval matrix | partly built | `case-access.ts` `authorityProblem`, R-6 | Authority is amount AND grade per approver, read from the staff table. No product or exception-type dimension, delegated levels or committee level. |
| WF-005 | Maker-checker on approval, override, booking, disbursement | built | R-4, R-5, R-6, `booking.service.ts` | The officer recommends and a different approver approves (overrides included). Booking maker ≠ checker. Disbursement runs in the checker's booking step, not as a separate checker step. |
| WF-006 | Unified case view | partly built | `cases/[id]/page.tsx`, `decision-panel.tsx`, F2-2 | Applicant, rule results, score, grade, reasons, decision record, recommendation, booking and history. No bureau detail card, documents, or full relationship data (only relationship months). |
| WF-007 | Request information/documents from borrower | not built | — | Deferred in ACCEPTANCE. |
| WF-008 | Auto-generated credit memo | not built | — | |
| WF-009 | Counter-offer on amount, tenor, pricing | partly built | F2-3..F2-5, `RecommendRequest` | Amount and tenor only (no pricing). The borrower accepts or rejects inside the simulated e-signature step. |
| WF-010 | Credit committee | not built | — | Above-authority cases are flagged escalated instead (ASSUMPTIONS). |
| WF-011 | Activity history with before/after | built | `activity-event.entity.ts` (from/to status, details), insert-only trigger (migration ...0002), F1-5 | Written in the same transaction as the change. |
| WF-012 | Withdrawal, expiry, cancellation | built | W-1, W-2, `lifecycle.ts` WITHDRAW/EXPIRE | The loan officer withdraws (cancels) a case before signing, with a reason code; drafts expire after 30 days and unsigned offers after 5 (a scheduled sweep). WITHDRAWN and EXPIRED are closed statuses. Expiry periods are constants, not configuration screens. |

### 6.4 Documents and e-signature (DOC)

| ID | Title | Status | Evidence | Notes |
|---|---|---|---|---|
| DOC-001 | Upload with type tagging, checks, virus scan | not built | — | |
| DOC-002 | OCR and mismatch flags | not built | — | |
| DOC-003 | Checklist tracking per case | not built | — | |
| DOC-004 | Template generation of agreements, disclosures | not built | — | |
| DOC-005 | E-signature with audit certificate | partly built | `packages/contracts/src/e-signature.port.ts`, simulator, F1-3 | A simulated borrower signature stores an envelope id. No bank signature, no stored certificate, no documents. |
| DOC-006 | Versioned, immutable document storage | not built | — | |
| DOC-007 | Bank statement analysis | not built | — | |

### 6.5 Collateral (COL)

| ID | Title | Status | Evidence | Notes |
|---|---|---|---|---|
| COL-001 | Register collateral | not built | — | |
| COL-002 | Appraisal requests and reports | not built | — | |
| COL-003 | LTV calculation and enforcement | not built | — | |
| COL-004 | Liens and insurance with alerts | not built | — | |
| COL-005 | Re-appraisal, release on closure | not built | — | |
| COL-006 | Deposit holds in core | not built | — | |

### 6.6 Booking and disbursement (BKG)

| ID | Title | Status | Evidence | Notes |
|---|---|---|---|---|
| BKG-001 | Pre-booking checklist | built | BK-1, `booking-checklist.ts` | Approvals complete, documents signed, KYC valid and disbursement account verified, shown on the booking step and enforced by the API (409, nothing written). Conditions from a credit committee or collateral (LTV, lien, insurance) are not items yet (no committee or collateral). |
| BKG-002 | Create core account, store reference | built | `booking.service.ts`, `GET /cases/:id/loan-account`, F1-4 | Simulated core. |
| BKG-003 | Disburse to borrower or third party, split | partly built | `disbursement.port.ts`, F1-4, F2-6 | One tranche to the applicant's simulated deposit account. No third-party or split payments. |
| BKG-004 | Idempotent booking | built | ADR 0020, B-1..B-3, B-6 | Key, unique constraints, row lock, idempotent providers. |
| BKG-005 | Exception queue and reconciliation report | partly built | B-5, B-8, BOOKING_FAILED in the operations queue | Failure state and retry with the same key. No dedicated exception screen and no reconciliation report or job (BUILD-STATUS "Gaps"). |
| BKG-006 | Staged disbursement (P2) | not built | — | Phase 2. |

### 6.7 Borrower self-service (SS)

Every SS requirement is a borrower-app feature, so each is not built and **OOR**.

| ID | Title | Status | Evidence | Notes |
|---|---|---|---|---|
| SS-001 | Status tracker | not built (**OOR**) | — | Borrower app. |
| SS-002 | Offer review and acceptance | not built (**OOR**) | — | Simulated by loan operations instead. |
| SS-003 | Live loan dashboard | not built (**OOR**) | — | |
| SS-004 | Repayment, auto-debit | not built (**OOR**) | — | |
| SS-005 | Statements and certificates | not built (**OOR**) | — | |
| SS-006 | Prepayment and payoff quotes | not built (**OOR**) | — | |
| SS-007 | Restructuring or holiday requests | not built (**OOR**) | — | The staff-side restructuring workflow is under CLX-005. |
| SS-008 | Top-up and repeat offers | not built (**OOR**) | — | |

### 6.8 Collections and recovery (CLX)

| ID | Title | Status | Evidence | Notes |
|---|---|---|---|---|
| CLX-001 | Daily delinquency feed and buckets | not built | — | Possible with a simulated core feed. |
| CLX-002 | Rule-based strategies | not built | — | |
| CLX-003 | Pre-due and overdue reminders | not built | — | Possible with simulated SMS and email. |
| CLX-004 | Collector queues, contact log, PTP | not built | — | |
| CLX-005 | Restructuring and settlement with approval | not built | — | |
| CLX-006 | External agencies (P2) | not built | — | Phase 2. |
| CLX-007 | Contact rules | not built | — | |
| CLX-008 | Write-off and recovery | not built | — | |

### 6.9 Analytics and reporting (RPT)

| ID | Title | Status | Evidence | Notes |
|---|---|---|---|---|
| RPT-001 | Origination funnel | not built | — | The case table has the data. |
| RPT-002 | Turnaround and SLA | not built | — | `activity_event` timestamps would support it. |
| RPT-003 | Decision mix with reason codes | not built | — | `decision_record` has outcome and reasons. |
| RPT-004 | Portfolio quality | not built | — | Needs repayment history (simulated core only). |
| RPT-005 | Collections performance | not built | — | Depends on CLX. |
| RPT-006 | Scheduled exports, warehouse feed | not built | — | |
| RPT-007 | Regulatory extracts | not built | — | |

### 6.10 Notifications (NTF)

| ID | Title | Status | Evidence | Notes |
|---|---|---|---|---|
| NTF-001 | Borrower notifications | not built | — | Could go through a simulated SMS/email port. |
| NTF-002 | Staff notifications | not built | — | Queue counts in the nav are the only signal. |
| NTF-003 | Per-case delivery log | not built | — | |

### 6.11 Platform and administration (PLT)

| ID | Title | Status | Evidence | Notes |
|---|---|---|---|---|
| PLT-001 | Reuse WhiteBank identity, SSO, MFA | partly built (**OOR** for SSO) | R-9, R-10, `session.guard.ts` | Own staff table, scrypt test passwords and signed cookie. Roles are re-read each request. Reusing WhiteBank identity needs the real platform. |
| PLT-002 | Multi-tenant isolation (P2) | not built | — | Phase 2. |
| PLT-003 | Branding and localisation from WhiteBank theming | partly built | `apps/backoffice/src/app/globals.css`, `packages/ui` | The prototype's tokens are used. No per-tenant theming or localisation. |
| PLT-004 | Immutable, searchable audit log | partly built | insert-only `activity_event`, `decision_record` | Per-case only, plus an insert-only history of automation changes (`automation_event`, AU-1). Sign-ins, simulation mode changes (`sim.service_mode.set_by` is overwritten) and other non-case actions are not logged. No search screen. |
| PLT-005 | Holiday calendars, business days | not built | ASSUMPTIONS "Business date" | Only a UTC+8 business date. No holidays, so due dates are not shifted. |
| PLT-006 | Feature flags | not built | — | |

### 7.2 Rules engine (DEC)

| ID | Title | Status | Evidence | Notes |
|---|---|---|---|---|
| DEC-001 | No-code rules editor | not built | — | Rules are code (ADR 0022 says to reconsider when this is needed). |
| DEC-002 | Rule types | partly built | `decide.ts`, `rule-sets.ts` | Knockout, referral trigger, derived variable (DTI) and grade-based pricing exist. No "warning" rule type or pricing-adjustment rules. |
| DEC-003 | Versioned rule sets, maker-checker, effective dates | partly built | `rule-sets.ts` | Versioned and immutable. No maker-checker or effective dates. |
| DEC-004 | Test harness draft vs live | partly built | `POST /decisions/:id/reproduce`, D-8 | Replays one stored decision on its own version. No comparison of draft against live over a set of cases. |
| DEC-005 | Decision bands, max auto-approval amount | built | `rule-sets.ts` (approveFrom, declineBelow, autoApprovalLimit), D-4, D-6 | Defined in code per product, not configurable from a screen. |
| DEC-006 | Configurable referral triggers | partly built | `decide.ts`, D-5, D-6, D-9, B-7, D-10..D-12, TR-1 | Grey zone, over limit, thin file or no hit, DTI, bureau unavailable, KYC/AML unavailable, and (RS-PL-2) declared vs verified income mismatch, fraud or identity flag, fraud check unavailable, related party. Missing: policy exception, low confidence. Not configurable: a change is a new rule-set version in code. |
| DEC-007 | Borrower-safe decline reason codes | built | `reason-codes.ts` (staff and borrower wording), D-7 | |
| DEC-008 | External decision engine option | not built | — | A simulated port is possible. |
| DEC-009 | Champion/challenger (P2) | not built | — | Phase 2. |

### 7.3 AI credit scoring (AIS)

| ID | Title | Status | Evidence | Notes |
|---|---|---|---|---|
| AIS-001 | Score, grade, PD, terms, reasons in 2 s p95 | partly built | `scorecards.ts`, decision record | Score, grade, rate and reasons. No PD and no recommended amount, and latency is not measured. |
| AIS-002 | Features from bureau, application, core, subject to consent | partly built | `DecisionInputs` snapshot | Bureau, application and relationship months are used. Consent is not checked (see INT-006). |
| AIS-003 | Plain-language reasons mapped to borrower-safe declines | built | `reason-codes.ts` | |
| AIS-004 | Cold-start: bureau score plus expert scorecard | built | `scorecards.ts` (SC-PL-1), D-1..D-9 | An additive expert scorecard that includes the bureau score band. This is the only model mode. |
| AIS-005 | Tenant-specific models after repayment outcomes | not built (**OOR**) | — | Needs real repayment outcomes. |
| AIS-006 | Pooled models (P2) | not built | — | Phase 2. |
| AIS-007 | Shadow mode | partly built | AU-1, AU-2, D-13, `automation.service.ts` | Per-product shadow mode: the engine scores and decides every application, its outcome is recorded (`engine_outcome`) and a person decides. Missing: agreement-rate and outcome reporting before automation is enabled, and shadowing a challenger model beside a live one. |
| AIS-008 | Model registry | partly built | `scorecards.ts` versions | Versions only. No lineage, validation, sign-off or deployment history. |
| AIS-009 | Drift and segment monitoring | not built | — | |
| AIS-010 | Fairness testing | not built (**OOR** for meaningful results) | — | A harness could run on synthetic personas, but the results would mean nothing without real data. |
| AIS-011 | Override capture feeding monitoring | partly built | OV01–OV06 on recommendations, F2-3/F2-4 | Captured and stored. Nothing consumes it. |
| AIS-012 | Prohibited-features list | not built | — | The scorecard uses no protected attribute, but there is no list or enforcement. |

### 7.4–7.5 Review and rollout controls

These are PRD sections, not requirement IDs.

| Ref | Title | Status | Evidence | Notes |
|---|---|---|---|---|
| §7.4 | Override needs reason code and rationale; above a threshold, a second approver | built | F2-3, F2-4, ASSUMPTIONS "Override" | Every recommendation goes to a different approver, so every override gets a second person whatever the threshold. The reviewer actions "request information" and "escalate" are not built (escalation happens only automatically, on an authority breach). |
| §7.5 | Automation off or shadow at launch, stepwise widening, per-product kill switch | partly built | AU-1..AU-3, `apps/backoffice/e2e/automation.spec.ts` | Per product: off, shadow or live, changed by one administrator and approved by another; a kill switch that one administrator turns on at once and two turn off. Every decision record stores the mode. PL is seeded live (today's behaviour), not off or shadow. Missing: stepwise widening (by segment, amount or share of traffic). |

### 8. Integrations (IH)

| ID | Title | Status | Evidence | Notes |
|---|---|---|---|---|
| IH-001 | Adapter framework, standard contract per category | built | `packages/contracts/src/*.port.ts`, `simulated-providers.module.ts` | Five ports. Swapping a provider changes one binding. |
| IH-002 | Per-tenant provider selection, secrets vault | not built (**OOR**) | — | Needs real providers and a vault. |
| IH-003 | Timeouts, retries, circuit breakers, fallbacks | partly built | `failure.ts`, B-5, B-7 | Timeouts fail and the decision falls back to referral. Booking is retried manually with the same key. No automatic retry with backoff and no circuit breaker. |
| IH-004 | Raw request/response logging, masked | not built | — | No applicant data is logged at all (AGENTS §2.8). |
| IH-005 | Result caching (30-day bureau reuse) | not built | — | |
| IH-006 | Per-call cost tracking | not built | — | |
| IH-007 | Simulated provider for every adapter | built | `apps/api/src/adapters/simulated/*`, `apps/api/test/simulators.e2e-spec.ts` | Bureau, KYC/AML, fraud check, core, disbursement and e-signature, with ok, outage, timeout and malformed modes (plus lost reply for core). There are no OCR, SMS or appraisal adapters yet. |
| IH-008 | Provider mode, live blocked outside production, labelled | partly built (**OOR** for sandbox and live) | `ProviderMode` in `packages/core/src/domain.ts`, the decision record's `provider_mode` | Simulated output is labelled and recorded. Sandbox and live need real providers. |
| IH-009 | Conformance test suite per category | built | `apps/api/test/simulators.e2e-spec.ts` | Runs against the simulators. Moving the suites into `packages/contracts` is deferred (BUILD-STATUS). |

### 9. Compliance (CMP)

| ID | Title | Status | Evidence | Notes |
|---|---|---|---|---|
| CMP-001 | Granular, versioned, revocable consents | not built | — | |
| CMP-002 | Disclosure statement before signing | not built | — | Deferred as a stretch item (ACCEPTANCE). |
| CMP-003 | Bureau submission files | not built | — | A file in a documented format can be generated from synthetic data. Submitting it needs a real bureau. |
| CMP-004 | Data privacy | partly built | `applicant.entity.ts` (only the last 4 digits of the government ID), masked IDs in views | Data minimisation and no applicant data in logs. No access, correction, retention or deletion workflow. |
| CMP-005 | AML at onboarding and pre-disbursement, escalation, export | partly built | `kyc-aml.port.ts`, D-2, R13 | Screened at submission. Not screened again before disbursement. No escalation and no export. |
| CMP-006 | Related-party controls | partly built | D-12, TR-1 | A related-party flag on the applicant (seeded) and mandatory referral (RS-PL-2, R18). Missing: where the flag comes from (a core or HR lookup), the special approval workflow and reporting. |
| CMP-007 | Fair lending | partly built | DEC-007 codes | Decline codes only. |
| CMP-008 | Model risk governance | not built | — | |
| CMP-009 | Fair collection | not built | — | Depends on CLX. |
| CMP-010 | Tamper-evident audit trail | partly built | `1764300000002-InsertOnlyRecords.ts` | UPDATE and DELETE are refused by triggers. No hash chain, so the trail is not tamper-evident, and TRUNCATE is not blocked (BUILD-STATUS). |
| CMP-011 | Segregation of duties | built | R-1..R-9, ADR 0020 | |
| CMP-012 | Data residency | not built (**OOR**) | — | A hosting decision. |

### 10. Non-functional (NFR)

| ID | Title | Status | Evidence | Notes |
|---|---|---|---|---|
| NFR-001 | 99.9% availability | not built (**OOR**) | — | Operational. |
| NFR-002 | Borrower API p95 < 500 ms | not built | — | Not measured, and there is no borrower API. |
| NFR-003 | Automated decision p95 < 60 s | partly built | synchronous submit | Not measured. A load or latency test against the simulators would cover it. |
| NFR-004 | 10,000 apps/day, 500 staff | not built | — | No load test. |
| NFR-005 | No lost applications; outages refer, never decline | built | B-7, B-10 | Outages refer; once the provider answers, the officer re-decides the case (new decision record, the old one kept). |
| NFR-006 | RPO ≤ 15 min, RTO ≤ 4 h | not built (**OOR**) | — | Operational. |
| NFR-007 | Tenant ID on every record | not built | — | Phase 1 asks for tenant ID columns even in a single-bank deployment. |
| NFR-008 | TLS, encryption at rest, field-level encryption, vault | partly built | secure cookie outside dev, scrypt hashes, last-4-only ID | No field-level encryption of financial data. TLS and the vault are deployment concerns. |
| NFR-009 | RBAC + ABAC; MFA | partly built | `@Roles`, `canView`, authority | Role access plus amount and grade authority. No branch or product attributes and no MFA. |
| NFR-010 | Pentest, scanning, ASVS | partly built (**OOR** for pentest) | `scripts/verify/verify.sh` security stage (gitleaks, semgrep, pnpm audit) | |
| NFR-011 | Decisions reproducible | built | ADR 0022, F1-2, D-8, `POST /decisions/:id/reproduce` | |
| NFR-012 | Logs, metrics, tracing, dashboards | not built | — | `/health` only. |
| NFR-013 | WCAG 2.1 AA borrower journeys; app < 10 min | not built (**OOR**) | — | Borrower journeys. The staff UI follows the ui-ux conventions but has not been audited. |
| NFR-014 | Multi-language, currency, formats | not built | — | English and PHP only. |
| NFR-015 | Cloud-native, containerised | partly built | `Dockerfile`, `docker-compose.yml`, `docs/DEPLOY.md` | Not deployed (M10 waiting). |
| NFR-016 | API-first modular services | partly built | packages core ← contracts ← base ← apps (dependency-cruiser) | Modular packages in one API process. |

## 2. Backlog (not built and partly built)

Items are ordered by value to the PRD's own Phase 1 exit criteria and success metrics (F1–F8
pass, 100% of decisions reproducible, outages degrade to referral, time to decision, time to
cash), and to the challenge capabilities already built. Ties are broken by effort.

Size key: S is about a day with tests, M is a few days, L is a week or more.

Every item is buildable with simulated services and synthetic data unless it is in the
**Out of reach** group at the end.

| # | Item | PRD IDs | Size | Why here |
|---|---|---|---|---|
| 1 | ✅ Done (B-10). Re-decide a referred case when the provider recovers: a new decision record, the old one kept, and a REVIEW → REVIEW edge | NFR-005, IH-003, NFR-011 | S | Today an outage referral cannot end in an approval, which breaks the PRD's "degrade to referral" promise. Small and contained. |
| 2 | ✅ Done (C-1). Consent capture on the application (bureau check, data processing, terms version, timestamp, channel); submit refused without it, and the bureau pull gated on it | INT-006, CMP-001 (part), AIS-002 | M | F1 and F3 both start with consent. The bureau is pulled today with no recorded consent. Migration + DTO + form + tests. |
| 3 | ✅ Done (A-7). Duplicate application detection by applicant and product (409 with the open case reference; partial unique index on open statuses) | INT-007 | S | P1 intake control the prototype already shows. Cheap DB-backed guard. |
| 4 | ✅ Done (W-1, W-2). Withdraw, cancel and offer expiry, with lifecycle edges to a WITHDRAWN/EXPIRED terminal state and a configurable expiry | WF-012, INT-003 (30-day expiry) | M | Closes cases that currently can only sit forever in DRAFT/OFFER; needed by every flow. |
| 5 | Request information from a referred case (REVIEW → INFO_REQUESTED → REVIEW), with a per-case document checklist (received, verified, rejected) and a simulated upload | WF-007, DOC-003, DOC-001 (simulated) | L | F2's own step 3. It completes the F2 path the PRD describes. |
| 6 | Compliance escalation on an AML knockout (an escalation record, a Compliance queue, mark reviewed, export file) plus re-screening before disbursement | CMP-005, F6 | M | Finishes F6. It is read-mostly and fits the existing Compliance role. |
| 7 | Booking exception screen and a reconciliation report or job comparing simulated core accounts with lending records | BKG-005 | M | The PRD names it, and BUILD-STATUS lists it as a known gap (crash between core commit and lending commit). |
| 8 | Searchable, tamper-evident audit log covering every action (hash-chained events, sign-ins and simulation mode changes, a Compliance search screen; TRUNCATE blocked) | PLT-004, CMP-010 | M | The "100% auditable" success metric. It builds on the insert-only tables. |
| 9 | ✅ Done (BK-1). Pre-booking checklist shown to loan operations and enforced by the API (approval, signature, conditions) | BKG-001 | S | Makes an existing guard visible and extends it to conditions. |
| 10 | ✅ Done (AU-1..AU-3, D-13). Per-product automation mode (off, shadow, live) and a kill switch routing every new case to referral, recorded in the decision record | §7.5, AIS-007 (mode only), F8 | M | Part of the PRD rollout model. The engine change is small; the record must carry the mode for replay. |
| 11 | ✅ Done (D-10..D-12, D-14, TR-1, TR-2). Missing referral triggers: income mismatch (declared vs verified), related-party flag, fraud flag (new simulated fraud port with failure modes) | DEC-006, CMP-006, F3 | M | F3 needs the income mismatch and CMP-006 needs mandatory referral. A new rule-set version keeps old decisions replayable. |
| 12 | Walk-in and new-customer capture (name, birth date, employer, income, obligations) with pre-fill from a simulated core customer lookup; branch officer role | INT-005, INT-002, F3 | M | F3's entry point. Today only seeded applicants can be chosen. |
| 13 | ✅ Done (IR-1). Indicative repayment before submission, from the core quote | INT-004 | S | The quote port already exists. It is shown after approval today. |
| 14 | Decision-mix and origination-funnel reports (outcome, override and reason-code counts; stage drop-off) | RPT-003, RPT-001 | S | Measures the PRD's straight-through-processing metric. The data is already stored. |
| 15 | SLA timers per stage with breach flags in the queues and a turnaround report | WF-003, RPT-002 | M | Measures the PRD's "referred decision within 1 business day" metric. Needs holiday-aware business time (PLT-005). |
| 16 | Queue routing: pick, reassign, priority, round robin | WF-002 | M | Team operations. Less critical with one officer. |
| 17 | Credit memo generated from the case, editable by the analyst, stored with versions | WF-008 | M | Part of F2 review in the PRD. |
| 18 | Disclosure statement generated from approved terms and acknowledged before the simulated signature; templates | CMP-002, DOC-004, SS-002 (staff side) | M | Truth in Lending requirement for the PH release. Needs a fee model (PC-002). |
| 19 | Configurable approval matrix (product, exception type, delegated levels) as data | WF-004 | M | Generalises the amount-and-grade authority already built. |
| 20 | Rule sets as published data with draft, review and publish under maker-checker, effective dates, and a draft-vs-live test harness over stored decisions | DEC-001, DEC-003, DEC-004, PC-005, PC-006, F8 | L | Needed for F8 and the "product setup in under 2 weeks" metric. Must keep ADR 0022 replay (published versions immutable). |
| 21 | Product configuration (core product reference, ranges, pricing grids, fees, form fields, document checklists) | PC-001..PC-004, PC-002 fees | L | Follows #20. Fees unblock #18. |
| 22 | Credit committee: circulation, votes, quorum, conditions, minutes | WF-010 | L | F5 and above-authority cases. Replaces today's "escalated" flag. |
| 23 | Notifications through a simulated SMS/email/push port: staff alerts, borrower templates, delivery log | NTF-001..003, CLX-003 | M | Needed by WF-007 and collections. |
| 24 | Tenant ID on every record | NFR-007 | M | A Phase 1 NFR. Cheaper before more tables exist. |
| 25 | Field-level encryption of financial fields; MFA (TOTP) for staff | NFR-008, NFR-009 | M | Security NFRs not blocked by mechanics. |
| 26 | Model registry, override and drift monitoring, prohibited-features list checked at scoring | AIS-008, AIS-009, AIS-011, AIS-012, CMP-007, CMP-008 | L | Governance around the scorecard. Meaningful only with volume. |
| 27 | PD and recommended amount from the scorecard; latency measurement | AIS-001, NFR-003 | S | Completes the AIS-001 output. |
| 28 | Provider resilience: automatic retry with backoff, circuit breaker, bureau result cache, per-call cost counter | IH-003, IH-005, IH-006 | M | Platform hardening. |
| 29 | Secured lending: collateral register, simulated appraisal, LTV enforcement, liens and insurance, deposit holds in simulated core; home-loan product | COL-001..006, PC-009, F5 | L | Second Phase 1 wave in the PRD ("then secured lending"). |
| 30 | Email and file intake with simulated OCR producing drafts; OCR on captured documents; statement analysis | INT-010, DOC-002, DOC-007, F4 | L | Needs #5 first. |
| 31 | Collections: simulated core delinquency feed, buckets, strategies, collector queue, PTP, contact rules, restructuring and write-off workflows | CLX-001..005, CLX-007, CLX-008, CMP-009, F7 | L | Third Phase 1 wave in the PRD ("then collections"). |
| 32 | Remaining reports and exports: portfolio quality, collections performance, scheduled exports, regulatory extracts, bureau submission file (generated, not submitted) | RPT-004..007, CMP-003 | L | Depends on #31 and on booked-loan history. |
| 33 | Platform items: per-tenant theming and localisation, holiday calendars, feature flags, multi-language, eligibility pre-check API, config export/import, lead capture, document storage with retention, data-subject requests, external decision engine port | PLT-003, PLT-005, PLT-006, NFR-014, PC-007, PC-008, INT-011, DOC-006, CMP-004, DEC-008 | M each | Individually small value to the MVP exit criteria. |
| 34 | Observability: structured logs, metrics, tracing, dashboards; load test to NFR-004 volumes | NFR-012, NFR-004, NFR-002 | M | Needed before a pilot, not before the demo. |

**Out of reach under the challenge mechanics (simulated only):**

| # | Item | PRD IDs | Size | Why out of reach |
|---|---|---|---|---|
| 35 | Borrower journeys: embeddable SDK, status tracker, offer acceptance, loan dashboard, repayments, statements, payoff, restructuring requests, top-ups; borrower WCAG and completion time | INT-001, SS-001..008, NFR-013 | L | Borrower mobile and web app. Staff-facing only by mechanics. |
| 36 | Reuse WhiteBank identity, SSO; per-tenant provider credentials in a vault; sandbox and live provider modes | PLT-001 (SSO part), IH-002, IH-008 (sandbox/live) | M | Real external platform and providers. |
| 37 | Tenant-specific models from repayment outcomes; meaningful fairness testing | AIS-005, AIS-010 | L | Needs non-synthetic outcome data. |
| 38 | Operational targets: availability, RPO/RTO, data residency, third-party pentest | NFR-001, NFR-006, CMP-012, NFR-010 (pentest) | L | Real infrastructure and third parties. |
| — | Phase 2 items, not in the Phase 1 backlog | PLT-002, BKG-006, CLX-006, DEC-009, AIS-006 | — | The PRD names these Phase 1 non-goals. |

## 3. Prototype features mapped to PRD items

The team prototype is a single-page staff shell with nine roles (branch, officer, approver,
operations and supervisor, collections, risk, compliance, admin) and the screens below. The
"Repo" column says what this repo has for the same feature.

| Prototype screen or feature | What it shows | PRD items | Repo |
|---|---|---|---|
| New assisted application, card 1 Customer | Existing customer picker "from core" that pre-fills name, age, employer, income and obligations; free entry for a new customer; relationship facts | INT-005, INT-002 | Partly built: you can only pick a seeded applicant (backlog #12). |
| New assisted application, card 2 Loan request | Product, purpose, amount and tenor with range hints and field errors; declared income and obligations; "indicative monthly repayment … calculated by core" | PC-002, INT-004, A-1..A-3 | Validation built (A-1..A-3). Indicative repayment at grade C pricing, calculated by simulated core (IR-1). |
| New assisted application, card 3 Documents | Government ID and payslip checklist; simulated scan or upload (type and size checks, virus-scan text); OCR income mismatch over 15% with "use verified" or "keep declared, flag for review" | DOC-001, DOC-002, DOC-003, DEC-006 (income mismatch), F3 | Not built (#5, #11, #30). |
| New assisted application, Consent card | Three consents (credit bureau check, data processing under the Data Privacy Act, terms and conditions v3.2); submit refused unless all three are ticked | INT-006, CMP-001 | Not built (#2). |
| New assisted application, submit guard | Refuses when the same name already has an open application for the same product ("already has an open … application") | INT-007 | Not built (#3). |
| New assisted application, Save draft | Draft "resumable for 30 days from any channel"; resume from the case | INT-003 | Draft save and edit built (A-4); 30-day expiry built (W-2). |
| Case view: stage bar, decision summary, policy rule results, bureau card, relationship card, checks table, bank statement analysis, documents with versions, activity history, masked Gov ID with Reveal, config version | The unified case | WF-006, WF-011, DOC-006, DOC-007, CMP-004 | Decision summary, rule results, history and masked ID built. No bureau, relationship or checks cards, statement analysis, documents or Reveal. |
| Case view, Decision record button | Stored inputs and versions | NFR-011, AIS-001 | Built, with reproduce (F1-2). |
| Case actions: Request information, Recommend decision, Credit memo, Reassign, Withdraw (reasons include "Duplicate application"), Resume draft | Review tools | WF-007, WF-008, WF-002, WF-012, INT-003 | Recommend built (F2-3..F2-5). Withdraw built (W-1). Others not built (#5, #17, #16). |
| Approval panel: recommendation, override above or below threshold, authority line, Approve, Return, Decline | Approver | §7.4, WF-004, WF-005 | Built (F2-5, R-6, R-8). |
| Work queues (Mine, Team, Unassigned with Pick), SLA watch, KPIs | Queues | WF-002, WF-003 | Role queue built. Team, pick and SLA not built (#15, #16). |
| Approvals, Credit committee | Approver and committee lists | WF-004, WF-010 | Approvals queue built. Committee not built (#22). |
| All applications (in progress, closed, all; channel column) | Case list | WF-001, RPT-001 | List built. No channels. |
| Email and file intake | Bundle or spreadsheet upload, OCR drafts | INT-010, F4 | Not built (#30). |
| Documents and signing | Templates and e-signature with certificate | DOC-004, DOC-005, CMP-002 | Simulated signature only (#18). |
| Booking (maker, then supervisor check with "different user" guard, idempotency key), Disbursements | Booking | BKG-001..004, WF-005 | Built (F1-4, B-1..B-6, R-5, pre-booking checklist BK-1). Split and third-party disbursement not built. |
| Booking exceptions with retry and a "Reconciliation · today" panel | Exceptions | BKG-005 | Retry built (B-5). No exception screen or reconciliation report (#7). |
| Collateral register, collateral detail, Deposit holds | Secured lending | COL-001..006, PC-009 | Not built (#29). |
| Delinquency overview, Collector queue, Restructuring, Write-off and recovery, Agency assignment (P2) | Collections | CLX-001..008 | Not built (#31). |
| Reports: Origination funnel, Turnaround and SLA, Decisioning dashboard, Portfolio quality, Collections performance, Scheduled reports, Regulatory extracts | Reports | RPT-001..007, CMP-003 | Not built (#14, #15, #32). |
| Compliance: Audit log (searchable, tamper-evident) | Audit | PLT-004, CMP-010 | Per-case history only (#8). |
| Compliance: Consent records | Consent register | CMP-001 | Not built (#2). |
| Compliance: AML escalations (mark reviewed and export) | AML | CMP-005, F6 | Not built (#6). |
| Compliance: Related-party lending, Segregation of duties, Data subject requests, Model governance, Fair collection oversight | Compliance views | CMP-006, CMP-011, CMP-004, CMP-008, CMP-009 | SoD enforced (R-1..R-9) but there is no screen. Others not built. |
| Configuration: Products, Workflows, Approval matrix (L1/L2/L3 and override threshold), Documents and templates, Notifications, Collection strategies | Config | PC-*, WF-001, WF-003, WF-004, DOC-004, NTF-*, CLX-002 | Not built (#19, #20, #21, #23). |
| Configuration: Decisioning (rules, bands, triggers, draft, submit for review, approve and publish by a different user, pipeline) | Rules | DEC-001..006, PC-005, F8 | Engine built in code. No editor or maker-checker publish (#20). |
| Configuration: AI models (registry, features, prohibited features, shadow, monitoring, fairness, overrides, automation per product, kill switch, pooled P2) | Models | AIS-007..012, §7.5 | Automation per product and kill switch built as the Automation controls screen (#10, with maker-checker). Registry, monitoring and the rest not built (#26). |
| Configuration: Integrations, API access, Users and roles (SSO, MFA), Tenant settings and modules | Admin | IH-002, IH-008, PLT-001, PLT-006 | Simulation controls only (`/simulation`). The rest is not built or out of reach. |
| Prototype's own "simulation" panel per case | Failure toggles | IH-007, IH-008 | Built as the admin Simulated services page (B-5, B-7). |

## 4. Where the PRD and the build differ

These are deliberate, documented choices, listed so nobody mistakes them for coverage.

1. **The PRD makes borrowers the actors in F1 and F2; the build uses staff.** In the PRD, the
   borrower applies, consents, accepts and signs in the WhiteBank app. In the build, a loan
   officer captures the application, and loan operations simulates the borrower's acceptance
   and e-signature (ASSUMPTIONS "Journey simplifications"). This follows the staff-only
   mechanics. It is not the PRD flow.
2. **No consent before the bureau pull.** INT-006 and AIS-002 make consent a precondition, but
   the build pulls the bureau on submission with no consent record.
3. **An outage referral was a dead end** (resolved by B-10: the officer re-decides once the provider answers).
