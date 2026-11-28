/**
 * RFC 9457 problem details: the one error body the API returns. `code` is stable and
 * machine-readable; `detail` is written for the person using the screen; `errors` lists
 * field-level validation problems. Internal details (stack, SQL, provider payloads) never
 * appear here.
 */
export interface FieldError {
  field: string;
  message: string;
}

export interface ProblemDetails {
  type: string;
  title: string;
  status: number;
  detail: string;
  code: string;
  instance?: string;
  errors?: FieldError[];
}

/** Stable error codes the backoffice can branch on. */
export const ProblemCode = {
  Validation: "VALIDATION_FAILED",
  DuplicateApplication: "DUPLICATE_APPLICATION",
  Unauthenticated: "UNAUTHENTICATED",
  Forbidden: "FORBIDDEN_ROLE",
  MakerChecker: "MAKER_CHECKER_VIOLATION",
  AuthorityLimit: "AUTHORITY_LIMIT_EXCEEDED",
  InvalidTransition: "INVALID_STATE_TRANSITION",
  BookingChecklistIncomplete: "BOOKING_CHECKLIST_INCOMPLETE",
  OverrideReasonRequired: "OVERRIDE_REASON_REQUIRED",
  NotFound: "NOT_FOUND",
  Conflict: "CONFLICT",
  ProviderUnavailable: "PROVIDER_UNAVAILABLE",
  ScheduleMismatch: "SCHEDULE_DOES_NOT_RECONCILE",
  RateLimited: "RATE_LIMITED",
  /** A module the bank has switched off (feature flags, PRD PLT-006). */
  FeatureDisabled: "FEATURE_DISABLED",
  /** Screening before disbursement matched a watchlist: nothing booked, escalated. */
  ScreeningMatch: "SCREENING_MATCH",
  /** A booking held by an AML escalation that Compliance has not cleared. */
  ComplianceHold: "COMPLIANCE_HOLD",
  Internal: "INTERNAL_ERROR",
} as const;
export type ProblemCode = (typeof ProblemCode)[keyof typeof ProblemCode];
