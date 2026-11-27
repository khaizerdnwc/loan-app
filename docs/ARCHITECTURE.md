# Architecture

The short reference for agents and reviewers. The longer narrative, with diagrams, is in
`docs/design-notes.md` §3–§5; decisions are in `docs/DECISIONS/`.

## Components and dependency direction

```
packages/core        Money, domain enums and labels, the HTTP contract types, RFC 9457 shape
packages/contracts   port interfaces: CreditBureau, KycAml, CoreBanking, Disbursement,
                     ESignature, SimulationControl (each with its Nest token)
packages/base        the lending domain — one Nest module (lending.module.ts):
                       auth/        test sign-in (scrypt), SessionGuard (global, fails closed)
                       cases/       capture, decision, review, approval, signing, booking,
                                    activity, views; lifecycle.ts is the transition table
                       simulation/  admin switches for the simulators
                       compliance/  AML escalations, screening again before disbursement
                       audit/       the hash-chained audit log (every case event, sign-ins,
                                    simulation changes) and its verification
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
REVIEW ─recommend─▶ APPROVAL ─approve─▶ OFFER · ─decline─▶ DECLINED · ─return─▶ REVIEW
OFFER ─sign─▶ BOOKING ─submit booking─▶ PENDING_CHECKER
PENDING_CHECKER | BOOKING_FAILED ─approve booking─▶ DISBURSED | BOOKING_FAILED
DRAFT | REVIEW | APPROVAL | OFFER ─withdraw (loan officer)─▶ WITHDRAWN
DRAFT | OFFER ─expire (sweep)─▶ EXPIRED
```

DECLINED, DISBURSED, WITHDRAWN and EXPIRED are closed: no edge leaves them. The expiry sweep
is a timer at the composition root (`apps/api/src/expiry-sweep.ts`) calling
`ExpiryService.expireStale` (`cases/expiry.service.ts`, the one service `LendingModule` exports
beyond auth); the domain has no scheduler. The periods (`DRAFT_EXPIRY_DAYS`,
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
| Authority: amount and grade | `CasesService.approve`, read from `staff` in the transaction |
| Maker-checker | `CasesService.approve` (recommender ≠ approver), `BookingService.book` (maker ≠ checker) |
| AML hold before disbursement | `ComplianceService.screenBeforeDisbursement`, inside the booking's locked transaction |
| Audit trail | `ActivityService.record` → `AuditService.append` (same transaction); triggers refuse UPDATE, DELETE, TRUNCATE |
| Override needs a reason | `CasesService.recommend` |
| Pre-booking checklist (BKG-001) | `BookingService.submit`, under the row lock; `cases/booking-checklist.ts` is the one gate the view and `allowedActions` also use |
| One booking, one payment | row lock + unique constraints + idempotent providers (ADR 0020) |
| UI | shows `allowedActions` with the API's reason; never decides |
