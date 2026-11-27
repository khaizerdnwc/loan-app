# API contract

The NestJS API (apps/api, port 3101 in development). Request and response shapes are the
types in `packages/core/src/api.ts`. Swagger UI is served at `/docs`. Every error is an
RFC 9457 problem body (`packages/core/src/problem.ts`) with a stable `code`.

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
| GET | /cases/:id | roles that can see the case's stage, and compliance | `CaseDetail` |
| GET | /cases/:id/activity | same as the case | `ActivityView[]` |
| GET | /cases/:id/decision | same as the case | `DecisionRecordView` |
| POST | /decisions/:id/reproduce | loan officer, approver, compliance | → `ReproduceResult`. Read-only: no state change, no activity row, so compliance may call it. Applies the owning case's visibility (404 outside it). |
| POST | /cases/:id/recommendation | loan officer (REVIEW) | `RecommendRequest` → `CaseDetail` |
| POST | /cases/:id/approve | approver (APPROVAL, within authority) | → `CaseDetail` |
| POST | /cases/:id/decline | approver (APPROVAL) | `DeclineRequest` → `CaseDetail` |
| POST | /cases/:id/return | approver (APPROVAL) | → `CaseDetail` (back to REVIEW) |
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
| APPROVE_BOOKING / RETRY_BOOKING | the supervisor submitted the booking | MAKER_CHECKER_VIOLATION |

A disabled APPROVE can still be posted: the API refuses it with that code and, for the
authority case, flags the case as escalated (ACCEPTANCE R-6).
