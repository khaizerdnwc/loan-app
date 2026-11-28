/**
 * The HTTP contract for compliance work: AML escalations (PRD CMP-005, F6) and the
 * tamper-evident audit log (PRD PLT-004, CMP-010). Kept apart from api.ts so the case
 * contract (CaseSummary, CaseDetail) stays untouched.
 */

/** When the screening that matched ran. */
export const ScreeningStage = {
  Onboarding: "ONBOARDING",
  PreDisbursement: "PRE_DISBURSEMENT",
} as const;
export type ScreeningStage = (typeof ScreeningStage)[keyof typeof ScreeningStage];

export const SCREENING_STAGE_LABEL: Record<ScreeningStage, string> = {
  ONBOARDING: "At application",
  PRE_DISBURSEMENT: "Before disbursement",
};

export const EscalationStatus = {
  Open: "OPEN",
  Acknowledged: "ACKNOWLEDGED",
  Closed: "CLOSED",
} as const;
export type EscalationStatus = (typeof EscalationStatus)[keyof typeof EscalationStatus];

export const ESCALATION_STATUS_LABEL: Record<EscalationStatus, string> = {
  OPEN: "Open",
  ACKNOWLEDGED: "Acknowledged",
  CLOSED: "Closed",
};

/** How Compliance closed an escalation. */
export const EscalationOutcome = {
  /** Not the listed person: a booking held by this match may go ahead. */
  FalsePositive: "FALSE_POSITIVE",
  /** The listed person: a held booking stays blocked. */
  ConfirmedMatch: "CONFIRMED_MATCH",
} as const;
export type EscalationOutcome = (typeof EscalationOutcome)[keyof typeof EscalationOutcome];

export const ESCALATION_OUTCOME_LABEL: Record<EscalationOutcome, string> = {
  FALSE_POSITIVE: "Cleared: false positive",
  CONFIRMED_MATCH: "Confirmed match",
};

export interface AmlEscalationView {
  id: string;
  caseId: string;
  caseReference: string;
  applicantName: string;
  stage: ScreeningStage;
  /** The list that matched, when the screening named one. */
  matchedList: string | null;
  /** The screening provider's mode (SIMULATED in this release). */
  providerMode: string;
  screenedAt: string;
  status: EscalationStatus;
  openedAt: string;
  openedByName: string;
  acknowledgedAt: string | null;
  acknowledgedByName: string | null;
  closedAt: string | null;
  closedByName: string | null;
  outcome: EscalationOutcome | null;
  notes: string | null;
  /** Booking attempts before the one that matched; above 0, core may already hold the loan. */
  priorBookingAttempts: number;
  /** What the escalation means for the case, in words. */
  effect: string;
}

export interface CloseEscalationRequest {
  outcome: EscalationOutcome;
  notes: string;
}

/** One entry in the audit log. */
export interface AuditEventView {
  seq: number;
  occurredAt: string;
  actorId: string;
  actorName: string;
  actorRole: string;
  action: string;
  /** Null when there is no case, or the caller's role may not read cases (admin). */
  caseId: string | null;
  caseReference: string | null;
  /** True when the entry is about a case the caller's role may not read (admin). */
  caseHidden: boolean;
  /** Null when the caller's role may not read the case behind the entry (admin). */
  summary: string | null;
  details: Record<string, unknown> | null;
  hash: string;
}

export interface AuditLogPage {
  items: AuditEventView[];
  /** Pass as `before` to read the next (older) page; null on the last page. */
  nextBefore: number | null;
}

export interface AuditChainVerification {
  intact: boolean;
  /** Entries recomputed. */
  checked: number;
  /** The first entry whose hash or link does not hold, when the chain is broken. */
  firstBrokenSeq: number | null;
  problem: string | null;
  headSeq: number | null;
  headHash: string | null;
  verifiedAt: string;
}

/** Words for the audit log's action codes (the code stays the stored value and the filter). */
export const AUDIT_ACTION_LABEL: Readonly<Record<string, string>> = {
  SIGN_IN_SUCCEEDED: "Signed in",
  SIGN_IN_FAILED: "Sign-in refused",
  SIGNED_OUT: "Signed out",
  SIMULATION_MODE_CHANGED: "Simulation mode changed",
  REPORT_EXPORTED: "Report downloaded",
  CASE_CREATED: "Application created",
  DRAFT_UPDATED: "Draft updated",
  CONSENT_RECORDED: "Consent recorded",
  CASE_SUBMITTED: "Submitted for decision",
  DECISION_MADE: "Automated decision",
  REDECIDED: "Decided again",
  RECOMMENDED: "Recommended",
  RECOMMENDED_WITH_OVERRIDE: "Recommended with override",
  ESCALATED: "Escalated above authority",
  APPROVED: "Approved",
  DECLINED: "Declined",
  RETURNED: "Returned to the officer",
  SIGNED: "E-signature recorded",
  BOOKING_SUBMITTED: "Booking submitted",
  BOOKING_APPROVED: "Booked and disbursed",
  BOOKING_RETRIED: "Booking retried and disbursed",
  BOOKING_FAILED: "Booking failed or held",
  AML_ESCALATION_OPENED: "AML review opened",
  AML_ESCALATION_ACKNOWLEDGED: "AML review acknowledged",
  AML_ESCALATION_CLOSED: "AML review closed",
  PRE_DISBURSEMENT_MATCH_AFTER_BOOKING: "Screening match after booking",
  HARNESS_RUN: "Rule-set test harness run",
};

/** An action code in words; an unknown code is shown as it is. */
export function auditActionLabel(code: string): string {
  return AUDIT_ACTION_LABEL[code] ?? code;
}

/** A reconciliation run whose feeds held no records carries no provider mode. */
export const NO_FEED_RECORDS = "NO_RECORDS";

export const PROVIDER_MODE_LABEL: Readonly<Record<string, string>> = {
  SIMULATED: "Simulated",
  [NO_FEED_RECORDS]: "No feed records",
};
