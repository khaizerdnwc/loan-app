# API contract

The NestJS API (apps/api, port 3101 in development). Request and response shapes are the
types in `packages/core/src/api.ts`. Swagger UI is served at `/docs` only when `SWAGGER_ENABLED=true` (local development). Every error is an
RFC 9457 problem body (`packages/core/src/problem.ts`) with a stable `code`.

Duplicates: `POST /cases` answers 409 `DUPLICATE_APPLICATION` (naming the open case) when the applicant already has an open application for the product.

Statuses: DRAFT, REVIEW, INFO_REQUESTED, APPROVAL, OFFER, BOOKING, PENDING_CHECKER, BOOKING_FAILED, DISBURSED, DECLINED, WITHDRAWN, EXPIRED. DECLINED, DISBURSED, WITHDRAWN and EXPIRED are closed (`CLOSED_CASE_STATUSES`): nothing leaves them, and they do not count as the applicant's open application. `CaseDetail.withdrawal` is `{ reasonCode, note, by, byName, at }` for a withdrawn case, else null; `CaseDetail.closedFrom` is the status a withdrawn or expired case was in when it closed. `CaseDetail.expiresAt` is when a DRAFT (`DRAFT_EXPIRY_DAYS` after its last change) or an OFFER (`OFFER_EXPIRY_DAYS` after it was made) expires, else null; both periods are exported by `@loan/core`.

Expiry: a draft unchanged for 30 days and an offer unsigned 5 days after it was made are refused (409 `INVALID_STATE_TRANSITION`, "This draft/offer expired on …") by `PATCH /cases/:id` (consent-only edits too), `submit` and `sign`, and an API timer (`EXPIRY_SWEEP_SECONDS`, 0 = off) moves them to EXPIRED with a SYSTEM activity event. There is no HTTP route for the sweep.

Pre-booking checklist (BKG-001): `CaseDetail.bookingChecklist` lists `{ check, label, passed, detail }` for APPROVALS_COMPLETE, DOCUMENTS_SIGNED, KYC_VALID and DISBURSEMENT_ACCOUNT_VERIFIED in BOOKING, PENDING_CHECKER and BOOKING_FAILED (else null). `POST /cases/:id/booking` and `POST /cases/:id/booking/approve` (approve and retry) answer 409 `BOOKING_CHECKLIST_INCOMPLETE` naming the first failing item, with nothing written, until every item passes.

Indicative repayment (INT-004): `CaseDetail.indicativeRepayment` is the `IndicativeRepaymentView` for the requested terms while the case has no decision (a draft), else null. `CaseDetail.approved.regularInstalment` is null when core banking cannot quote it; the case still opens.

Documents (WF-007, DOC-003): `CaseDetail.infoRequest` is the latest request `{ documents, message, dueOn, requestedBy, requestedByName, requestedAt }` or null; `CaseDetail.documents` is the checklist, one `CaseDocumentView` per requested type `{ type, status: REQUESTED | RECEIVED | VERIFIED | REJECTED, requestedAt, upload (synthetic metadata, labelled SIMULATED) | null, review | null, actions }`, where `actions` lists what the caller may do with it now (SIMULATE_UPLOAD, VERIFY, REJECT). The due date is shown, not enforced.

Consent: `POST /cases` and `PATCH /cases/:id` accept `consent: { creditBureauCheck, dataProcessing, termsVersion }` (current version `CONSENT_TERMS_VERSION`, 1.0). `POST /cases/:id/submit` (and `POST /cases` with `submit: true`) answers 400 on the `consent` field until both consents for the current version are recorded; `CaseDetail.consent` shows the latest record.

Screening before disbursement (PRD CMP-005): `POST /cases/:id/booking/approve` screens the applicant again before booking. A watchlist match answers 409 `SCREENING_MATCH` without naming the list (this attempt booked nothing; after an earlier failed attempt it says that attempt may have reached core; the booking is failed and held; an AML escalation opens); while that escalation is open, or after Compliance confirms the match, the call answers 409 `COMPLIANCE_HOLD` and writes nothing; screening unavailable answers 503 and holds the booking for a retry.

Audit: sign-ins (success, failure, sign-out), simulation mode changes and every case activity event are written to the hash-chained audit log (`audit_event`, insert-only) in the transaction of the change.

Authentication: `POST /auth/sign-in` checks a username and test password and sets an httpOnly
`session` cookie (a signed JWT carrying only the staff id). There is no password-less route.
The backoffice never calls the API from the browser directly: its `/api/*` route forwards
to the API with the cookie, so the session stays first-party. Tests may send
`Authorization: Bearer <token>` instead.

| Method | Path | Roles | Body → Response |
|---|---|---|---|
| GET | /health | public | `{ status: "ok" }` |
| POST | /auth/sign-in | public (throttled 20/min) | `{ username, password }` → `StaffView` + cookie; 401 for an unknown user or a wrong password alike |
| POST | /auth/logout | any signed-in | 204, clears the cookie |
| GET | /auth/me | any signed-in | `StaffView` |
| GET | /products/PL | any signed-in | `ProductView` |
| GET | /products/PL/quote?amount=&tenorMonths= | loan officer | `IndicativeRepaymentView`: the indicative monthly repayment for the terms at grade C pricing, quoted by core banking (simulated). 400 with field errors for terms outside the product; 200 with `status: "UNAVAILABLE"` and null amounts when core cannot answer. Writes nothing |
| GET | /applicants | loan officer | `ApplicantView[]` |
| GET | /cases?view=queue\|all | any signed-in except admin | `CaseList` (queue = the cases waiting on the caller's role; for an approver, only APPROVAL cases within their authority) |
| POST | /cases | loan officer | `CreateCaseRequest` → `CaseDetail` (submit=true runs the decision) |
| PATCH | /cases/:id | loan officer (draft only) | `UpdateDraftRequest` → `CaseDetail` |
| POST | /cases/:id/submit | loan officer (draft only) | → `CaseDetail` |
| POST | /cases/:id/redecide | loan officer | Re-run the decision on a case referred while a provider was down → `CaseDetail`. 503 while a provider still cannot answer (nothing written); 409 outside REVIEW or if its decision had every provider answering. Clears the earlier recommendation, approver and escalation |
| GET | /cases/:id | roles that can see the case's stage, and compliance | `CaseDetail` |
| GET | /cases/:id/activity | same as the case | `ActivityView[]` |
| GET | /cases/:id/decision | same as the case | `DecisionRecordView` |
| POST | /decisions/:id/reproduce | loan officer, approver, compliance | → `ReproduceResult`. Read-only: no state change, no activity row, so compliance may call it. Applies the owning case's visibility (404 outside it). |
| POST | /cases/:id/recommendation | loan officer (REVIEW) | `RecommendRequest` → `CaseDetail` |
| POST | /cases/:id/approve | approver (APPROVAL, within authority) | → `CaseDetail` |
| POST | /cases/:id/decline | approver (APPROVAL) | `DeclineRequest` → `CaseDetail` |
| POST | /cases/:id/return | approver (APPROVAL) | → `CaseDetail` (back to REVIEW) |
| POST | /cases/:id/info-request | loan officer (REVIEW) | `InfoRequestRequest` `{ documents: (BANK_STATEMENTS_3M \| CERTIFICATE_OF_EMPLOYMENT \| INCOME_TAX_RETURN)[], message, dueInDays: 3 \| 5 }` → `CaseDetail` (INFO_REQUESTED). 400 for no or unknown documents, no message, another due date, or a document already verified; 409 outside REVIEW or while a received document is not reviewed, nothing written |
| POST | /cases/:id/documents/:type/upload | loan officer (INFO_REQUESTED, document REQUESTED) | The borrower's upload, simulated through the DocumentIntake port → `CaseDetail`; the last awaited document moves the case back to REVIEW. 503 when the upload service cannot answer (nothing written); 409 when the document is not waiting for an upload |
| POST | /cases/:id/documents/:type/review | loan officer (REVIEW or INFO_REQUESTED, document RECEIVED) | `DocumentReviewRequest` `{ decision: VERIFIED \| REJECTED, reason? }` (reason required to reject) → `CaseDetail`. 409 when the document has not been received |
| POST | /cases/:id/withdraw | loan officer (DRAFT, REVIEW, INFO_REQUESTED, APPROVAL, OFFER) | `WithdrawRequest` `{ reasonCode: APPLICANT_REQUEST \| DUPLICATE_APPLICATION \| NOT_PROCEEDING, note? }` → `CaseDetail` (WITHDRAWN). 409 from any other status, nothing written; 400 for a missing or unknown reason or a note over 2000 characters |
| POST | /cases/:id/sign | loan operations, supervisor (OFFER) | → `CaseDetail` (simulated e-signature) |
| POST | /cases/:id/booking | loan operations, supervisor (BOOKING) | → `CaseDetail` (maker step) |
| POST | /cases/:id/booking/approve | supervisor, not the maker (PENDING_CHECKER or BOOKING_FAILED) | → `CaseDetail` (books and disburses). Both APPROVE_BOOKING and RETRY_BOOKING use this endpoint, with the same idempotency key (ADR 0020 R5); the maker stays excluded on retry. |
| GET | /cases/:id/loan-account | roles that can see the case | `LoanAccountView` |
| GET | /simulation/services | any signed-in | `SimulationServiceView[]` |
| PUT | /simulation/services/:service | admin | `SetSimulationModeRequest` → `SimulationServiceView` (services include `FRAUD`, the simulated fraud check; the change is written to the audit log) |
| GET | /compliance/escalations?view=open\|all | compliance | `AmlEscalationView[]` (default open: not closed), newest first |
| GET | /compliance/escalations/:id | compliance | `AmlEscalationView` |
| POST | /compliance/escalations/:id/acknowledge | compliance (Open) | → `AmlEscalationView`; 409 if already acknowledged or closed |
| POST | /compliance/escalations/:id/close | compliance (Open or Acknowledged) | `CloseEscalationRequest` (`outcome`: FALSE_POSITIVE \| CONFIRMED_MATCH, `notes`) → `AmlEscalationView`; 400 without notes, 409 if closed |
| GET | /audit/events?actor=&action=&from=&to=&case=&before=&limit= | compliance, admin | `AuditLogPage` (newest first; `from`/`to` are business dates, inclusive; `before` pages by seq; limit 1–200, default 50). `case` is Compliance only (403 for admin). On a case entry the admin gets `caseHidden: true` and `caseId`, `caseReference`, `summary` and `details` null |
| GET | /audit/actions | compliance, admin | `string[]`: the action codes in the log |
| GET | /audit/verify | compliance, admin | `AuditChainVerification`: recomputes every hash from entry 1 |
| GET | /automation | admin, compliance | `AutomationView[]`: each product's mode (OFF, SHADOW, LIVE), kill switch, the change waiting for approval, and the caller's `allowedActions` (none for compliance) |
| GET | /automation/:product/history | admin, compliance | `AutomationEventView[]`, newest first: who changed what, when, before and after |
| POST | /automation/:product/changes | admin | `AutomationChangeRequest` (`{ kind: "SET_MODE", mode, reason }` or `{ kind: "KILL_SWITCH_OFF", reason }`) → `AutomationView[]` (201). Drafts a change for a different administrator; nothing changes yet. 409 `CONFLICT` while another change waits; 400 for the current mode or a blank reason; 409 to turn off a switch that is off |
| POST | /automation/:product/changes/:id/approve | admin, not the drafter | `{ note? }` → `AutomationView[]`. The change takes effect. 403 `MAKER_CHECKER_VIOLATION` for the drafter; 409 if no longer pending |
| POST | /automation/:product/changes/:id/reject | admin | `{ note? }` → `AutomationView[]`. Closes it unchanged: REJECTED, or WITHDRAWN when the drafter closes it |
| POST | /automation/:product/kill-switch | admin | `{ reason }` → `AutomationView[]`. Turns the kill switch on at once (409 if already on); turning it off is a change request |

Who sees what (`GET /cases`, `GET /cases/:id`):

| Role | Cases visible |
|---|---|
| Loan officer | every case (they create and review them) |
| Approver | APPROVAL, and every case they approved, declined or returned |
| Loan operations / supervisor | OFFER, BOOKING, PENDING_CHECKER, BOOKING_FAILED, DISBURSED |
| Compliance | every case, read-only |
| Admin | none (simulation and automation controls only) |

A withdrawn or expired case stays visible to the loan officer and compliance (and to an
approver who acted on it); it leaves the operations stages.

A case outside the caller's view answers 404, not 403, so its existence is not revealed.
An approver's `view=all` shows every APPROVAL case, including ones above their authority.

Decision records (`DecisionRecordView`) carry `automationMode`, `killSwitch` and `engineOutcome`:
the mode the decision ran under and what the engine decided before the mode applied
(`outcome` is what the case did). Records made before automation modes read `LIVE`, `false` and
their own outcome. `POST /decisions/:id/reproduce` also checks the mode columns against the
stored snapshot.

`CaseDetail.decidedDuringOutage` says the current decision was made while the bureau,
screening or fraud check could not answer (the officer re-decides it).
`CaseDetail.recommendationTypes`, when RECOMMEND is offered, lists APPROVE, COUNTER_OFFER and
DECLINE each enabled or disabled with the API's reason: after an outage or a failed knockout
only DECLINE is accepted, and `POST /cases/:id/recommendation` refuses the others (409).

Automation `allowedActions` are REQUEST_MODE_CHANGE, KILL_SWITCH_ON, REQUEST_KILL_SWITCH_OFF,
APPROVE_CHANGE (disabled with MAKER_CHECKER_VIOLATION for the drafter), REJECT_CHANGE (another
administrator) and WITHDRAW_CHANGE (the drafter); reject and withdraw both post to `/reject`.

`CaseDetail.allowedActions` lists each action the caller's role could take in the case's
current status, with `enabled: false`, `blockedBy` and `detail` when a server-side rule
refuses it now:

| Action | Disabled when | blockedBy |
|---|---|---|
| APPROVE | amount above the approver's limit, or grade outside their grades | AUTHORITY_LIMIT_EXCEEDED |
| APPROVE | the approver made the recommendation (defence in depth: one person holds one role today, so the role guard already refuses this) | MAKER_CHECKER_VIOLATION |
| APPROVE | the recommendation is to decline (decline or return it instead) | INVALID_STATE_TRANSITION |
| APPROVE | the case was decided while a provider could not answer (return it to be decided again) | INVALID_STATE_TRANSITION |
| APPROVE_BOOKING / RETRY_BOOKING | the supervisor submitted the booking | MAKER_CHECKER_VIOLATION |
| RECOMMEND / REQUEST_INFO | a received document is not verified or rejected yet (REQUEST_INFO also: every document already verified) | INVALID_STATE_TRANSITION |
| SUBMIT_BOOKING / APPROVE_BOOKING / RETRY_BOOKING | an item of the pre-booking checklist fails (the first failing item is the detail) | BOOKING_CHECKLIST_INCOMPLETE |
| EDIT_DRAFT / SUBMIT | the draft is unchanged for 30 days (expired; the sweep closes it) | INVALID_STATE_TRANSITION |
| SIGN | the offer was made more than 5 days ago (expired; the sweep closes it) | INVALID_STATE_TRANSITION |
| APPROVE_BOOKING / RETRY_BOOKING | an AML escalation from screening before disbursement is open, or Compliance confirmed the match | COMPLIANCE_HOLD |

A disabled APPROVE can still be posted: the API refuses it with that code and, for the
authority case, flags the case as escalated (ACCEPTANCE R-6).
