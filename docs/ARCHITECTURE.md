# Architecture

The short reference for agents and reviewers. The longer narrative, with diagrams, is in
`docs/design-notes.md` §3–§5; decisions are in `docs/DECISIONS/`.

## Components and dependency direction

```
packages/core        Money, domain enums and labels, the HTTP contract types, RFC 9457 shape
packages/contracts   port interfaces: CreditBureau, KycAml, FraudCheck, CoreBanking,
                     Disbursement, ESignature, DocumentIntake, CustomerLookup,
                     DocumentExtraction (OCR and statement analysis), SimulationControl (each
                     with its Nest token)
packages/base        the lending domain — one Nest module (lending.module.ts):
                       auth/        test sign-in (scrypt), SessionGuard (global, fails closed)
                       cases/       capture, decision, review, approval, signing, booking,
                                    activity, views; lifecycle.ts is the transition table
                       simulation/  admin switches for the simulators
                       governance/  model registry, override and drift monitoring (read-only)
                       eligibility/ the eligibility pre-check over stated figures (stores nothing)
                       providers/   the decision's provider gateway: retry with backoff,
                                    circuit breaker, 30-day bureau reuse, per-call cost
                       automation/  per-product automation mode and kill switch
                                    (maker-checker between two administrators)
                       compliance/  AML escalations, screening again before disbursement
                       audit/       the hash-chained audit log (every case event, sign-ins,
                                    simulation changes) and its verification
                       operations/  booking exceptions; reconciliation against core's
                                    account feed and the payment feed (ports)
                       reports/     decision mix and origination funnel (read-only)
                       sla/         stage SLAs in Philippine business time, the holiday
                                    calendar and turnaround (read-only over the history)
                       notifications/  staff alerts and the borrower-message outbox
                                    (written in the case event's transaction), the
                                    sender (port, outside any transaction), SLA alerts
                       intake/      email and file intake (OCR drafts confirmed into case
                                    drafts) and OCR readings of case documents
                       decisioning/engine/  pure, versioned decide()
                       database/    data source, migrations, transaction runner
                       seed/        synthetic staff, applicants, product
packages/ui          presentational components and formatters (formatPeso)
apps/api             bootstrap, env, composition root; adapters/simulated/* bind the ports
apps/backoffice      Next.js staff console; its /api route is the only path to the API
```

Direction (dependency-cruiser): `core ← contracts ← base ← apps/api`; `core ← ui ←
apps/backoffice`. The backoffice never imports `base`, `contracts` or `apps/api`. From
`core` it uses types plus the label maps (`ROLE_LABEL`, reason labels). The decision engine
imports nothing with I/O.

Product automation (`automation/`) is a second aggregate that stays in `LendingModule`: the
decision reads the product's mode under a share lock inside the case's own transaction
(`DecisionService.decideAndRecord` → `AutomationService.forDecision`), so both need the same
transaction runner, and a separate module would only re-export it. Split it out if automation
grows its own consumers (rules editor, model registry).

### Why compliance and audit stay in the lending module

An AML escalation has its own table, repository, small lifecycle (open, acknowledged, closed)
and controller, so it could look like the "second aggregate" that would justify its own Nest
module. It stays in `LendingModule` on purpose: escalations are opened inside the lending
transaction that holds the case row lock (the decision on submit, the failed booking before
disbursement), and the booking's hold check runs inside the checker's locked transaction.
Both need the same `TransactionRunner`, `ActivityService` and `CasesRepository` as the case
services, and a separate module would only re-export them. The audit log is written by
`ActivityService` in every case transaction, so it is shared infrastructure of the same
module. `cases/` and `compliance/` import each other's services (no file or DI cycle);
`activity.service.ts` imports `audit/` only, never `compliance/`. Revisit when collections
or a committee adds a real second aggregate.

`operations/` stays inside for the same reason: it works on the booking and case aggregate
(it reads `BookingRequestEntity` and `LoanCaseEntity`, uses `CasesRepository` and the same
transaction runner), and its `reconciliation_run` table is an insert-only run log, not an
aggregate of its own. `reports/` owns no state at all: it is read-only aggregate queries over
the case, decision and activity tables. `sla/` is the same kind: read-only queries over the activity history, plus a holiday calendar that is reference data, not an aggregate. `notifications/` hangs off the activity history: `cases/activity.service.ts` calls `NotificationService.onActivity` on its own manager after the audit append, so a case event's staff alerts and borrower-message outbox rows commit with it or not at all. `NotificationService` depends only on its repository (which reads `LoanCaseEntity` for the reference and owner), the transaction runner and the `NOTIFICATIONS` port, and sends outside any transaction; `NotificationReadsService` (the reads, mark read, SLA-breach alerts) uses `cases/` (visibility) and `sla/` (clocks). Keeping the two apart is what keeps the DI graph acyclic: nothing in `cases/` or `sla/` imports the reads service. Folder dependencies stay one-way: `sla/` uses `cases/` (visibility) and `reports/` (period rules and readers), and nothing in `cases/` or `reports/` imports `sla/`; the turnaround report keeps its `/reports/turnaround` URL but its controller is declared in `sla/`.

`intake/` stays inside too: an intake draft is confirmed into a case draft inside the same
transaction (`CasesService.captureDraft`, INT-007 and the case's activity events), and an OCR
reading of a case document is written under the case's row lock with a case event; both need
the case repository, activity service and transaction runner. `intake_draft` is a small
review queue that only ever feeds the case aggregate. Folder dependencies stay one-way:
`intake/` uses `cases/` (and `audit/`), and nothing in `cases/` imports `intake/`.

## Ports and simulators

Domain code injects a token and types against the port. Only
`apps/api/src/adapters/simulated/simulated-providers.module.ts` binds a token to a
simulator. Every simulator supports OK, OUTAGE, TIMEOUT and MALFORMED; core banking also
supports LOST_REPLY. A non-OK mode resets after 15 minutes. Simulators keep their own state
in the `sim` schema and use their own statements, outside the lending transaction. The
provider mode stored on decision records, loan accounts and disbursements comes from the port
or its result.

## Case lifecycle

```
DRAFT ─submit─▶ OFFER | REVIEW | DECLINED
REVIEW ─request information─▶ INFO_REQUESTED ─last requested document received─▶ REVIEW
REVIEW ─recommend─▶ APPROVAL ─approve─▶ OFFER · ─decline─▶ DECLINED · ─return─▶ REVIEW
OFFER ─sign─▶ BOOKING ─submit booking─▶ PENDING_CHECKER
PENDING_CHECKER | BOOKING_FAILED ─approve booking─▶ DISBURSED | BOOKING_FAILED
DRAFT | REVIEW | INFO_REQUESTED | APPROVAL | OFFER ─withdraw (loan officer)─▶ WITHDRAWN
DRAFT | OFFER ─expire (sweep)─▶ EXPIRED
```

DECLINED, DISBURSED, WITHDRAWN and EXPIRED are closed: no edge leaves them. The expiry sweep
is a timer at the composition root (`apps/api/src/expiry-sweep.ts`) calling
`ExpiryService.expireStale` (`cases/expiry.service.ts`; `LendingModule` exports it and, for the
API's `GET /metrics`, `ProviderGateway`, beyond auth); the domain has no scheduler. The periods (`DRAFT_EXPIRY_DAYS`,
`OFFER_EXPIRY_DAYS`) live in `packages/core`, read by the API and the backoffice alike.

The transition table in `cases/lifecycle.ts` is the only code that writes a status, through
`moveTo(c, event, to)` (both ends checked) and `startDraft`. A lint rule enforces it. Every
state change happens in one transaction with its activity event.

## Security boundaries

| Control | Enforced in |
|---|---|
| Signed in; role and name re-read from `staff` on every request | `SessionGuard` (global; no `@Roles`/`@Public` → 403) |
| Role may call the endpoint | `@Roles` on every handler (lint rule) |
| Case visible to the role (404 outside it) | `canView` (reads), `CasesRepository.list` (lists) |
| Authority: the approver's level in the approval matrix (product, amount, grade, exception) | `CasesService.approve` via `cases/approval-matrix.ts`, the level read with the `staff` row in the transaction |
| Maker-checker | `CasesService.approve` (recommender ≠ approver), `BookingService.book` (maker ≠ checker) |
| AML hold before disbursement | `ComplianceService.screenBeforeDisbursement`, inside the booking's locked transaction |
| Audit trail | `ActivityService.record` → `AuditService.append` (same transaction); triggers refuse UPDATE, DELETE, TRUNCATE |
| Override needs a reason | `CasesService.recommend` |
| Pre-booking checklist (BKG-001) | `BookingService.submit`, under the row lock; `cases/booking-checklist.ts` is the one gate the view and `allowedActions` also use |
| One booking, one payment | row lock + unique constraints + idempotent providers (ADR 0020) |
| UI | shows `allowedActions` with the API's reason; never decides |
