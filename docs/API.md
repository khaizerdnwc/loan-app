# API contract

The NestJS API (apps/api, port 3101 in development). Request and response shapes are the
types in `packages/core/src/api.ts`. Swagger UI is served at `/docs` only when `SWAGGER_ENABLED=true` (local development). Every error is an
RFC 9457 problem body (`packages/core/src/problem.ts`) with a stable `code`.

Duplicates: `POST /cases` answers 409 `DUPLICATE_APPLICATION` (naming the open case) when the applicant already has an open application for the product.

Statuses: DRAFT, REVIEW, APPROVAL, OFFER, BOOKING, PENDING_CHECKER, BOOKING_FAILED, DISBURSED, DECLINED, WITHDRAWN, EXPIRED. DECLINED, DISBURSED, WITHDRAWN and EXPIRED are closed (`CLOSED_CASE_STATUSES`): nothing leaves them, and they do not count as the applicant's open application. `CaseDetail.withdrawal` is `{ reasonCode, note, by, byName, at }` for a withdrawn case, else null; `CaseDetail.closedFrom` is the status a withdrawn or expired case was in when it closed. `CaseDetail.expiresAt` is when a DRAFT (`DRAFT_EXPIRY_DAYS` after its last change) or an OFFER (`OFFER_EXPIRY_DAYS` after it was made) expires, else null; both periods are exported by `@loan/core`.

Expiry: a draft unchanged for 30 days and an offer unsigned 5 days after it was made are refused (409 `INVALID_STATE_TRANSITION`, "This draft/offer expired on …") by `PATCH /cases/:id` (consent-only edits too), `submit` and `sign`, and an API timer (`EXPIRY_SWEEP_SECONDS`, 0 = off) moves them to EXPIRED with a SYSTEM activity event. There is no HTTP route for the sweep.

Consent: `POST /cases` and `PATCH /cases/:id` accept `consent: { creditBureauCheck, dataProcessing, termsVersion }` (current version `CONSENT_TERMS_VERSION`, 1.0). `POST /cases/:id/submit` (and `POST /cases` with `submit: true`) answers 400 on the `consent` field until both consents for the current version are recorded; `CaseDetail.consent` shows the latest record.

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
| POST | /cases/:id/withdraw | loan officer (DRAFT, REVIEW, APPROVAL, OFFER) | `WithdrawRequest` `{ reasonCode: APPLICANT_REQUEST \| DUPLICATE_APPLICATION \| NOT_PROCEEDING, note? }` → `CaseDetail` (WITHDRAWN). 409 from any other status, nothing written; 400 for a missing or unknown reason or a note over 2000 characters |
| POST | /cases/:id/sign | loan operations, supervisor (OFFER) | → `CaseDetail` (simulated e-signature) |
| POST | /cases/:id/booking | loan operations, supervisor (BOOKING) | → `CaseDetail` (maker step) |
| POST | /cases/:id/booking/approve | supervisor, not the maker (PENDING_CHECKER or BOOKING_FAILED) | → `CaseDetail` (books and disburses). Both APPROVE_BOOKING and RETRY_BOOKING use this endpoint, with the same idempotency key (ADR 0020 R5); the maker stays excluded on retry. |
| GET | /cases/:id/loan-account | roles that can see the case | `LoanAccountView` |
| GET | /simulation/services | any signed-in | `SimulationServiceView[]` |
| PUT | /simulation/services/:service | admin | `SetSimulationModeRequest` → `SimulationServiceView` |

Who sees what (`GET /cases`, `GET /cases/:id`):

| Role | Cases visible |
|---|---|
| Loan officer | every case (they create and review them) |
| Approver | APPROVAL, and every case they approved, declined or returned |
| Loan operations / supervisor | OFFER, BOOKING, PENDING_CHECKER, BOOKING_FAILED, DISBURSED |
| Compliance | every case, read-only |
| Admin | none (simulation controls only) |

A withdrawn or expired case stays visible to the loan officer and compliance (and to an
approver who acted on it); it leaves the operations stages.

A case outside the caller's view answers 404, not 403, so its existence is not revealed.
An approver's `view=all` shows every APPROVAL case, including ones above their authority.

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
| EDIT_DRAFT / SUBMIT | the draft is unchanged for 30 days (expired; the sweep closes it) | INVALID_STATE_TRANSITION |
| SIGN | the offer was made more than 5 days ago (expired; the sweep closes it) | INVALID_STATE_TRANSITION |

A disabled APPROVE can still be posted: the API refuses it with that code and, for the
authority case, flags the case as escalated (ACCEPTANCE R-6).
