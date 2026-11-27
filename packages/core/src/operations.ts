/**
 * The HTTP contract for booking exceptions and reconciliation (PRD BKG-005) and the
 * decision-mix and origination-funnel reports (PRD RPT-003, RPT-001). Amounts are decimal
 * strings, as everywhere on the API.
 */

/** A case whose booking failed or is held, as loan operations sees it. */
export interface BookingExceptionView {
  caseId: string;
  caseReference: string;
  applicantName: string;
  /** The approved principal. */
  amount: string;
  idempotencyKey: string;
  attempts: number;
  lastError: string | null;
  lastAttemptAt: string;
  /** Why a retry is blocked now (an AML hold or the pre-booking checklist), or null. */
  blockedReason: string | null;
  /** What the latest reconciliation found for this booking key, or null. */
  reconciliation: ReconciliationKind | null;
}

export const ReconciliationKind = {
  /** Core holds an account under the key, lending has none, and nothing was paid. */
  CoreAccountUndisbursed: "CORE_ACCOUNT_UNDISBURSED",
  /** Core holds an account and the payment rail paid it, but lending recorded neither. */
  CoreAccountPaidUnrecorded: "CORE_ACCOUNT_PAID_UNRECORDED",
  /** Lending recorded a loan account that core does not hold. */
  LendingAccountMissingInCore: "LENDING_ACCOUNT_MISSING_IN_CORE",
  /** Both sides hold the account, but its number or principal differs. */
  AccountMismatch: "ACCOUNT_MISMATCH",
  /** Lending recorded a disbursement the payment rail does not hold, or with another amount. */
  PaymentMismatch: "PAYMENT_MISMATCH",
  /** A core account or payment under a key lending never issued. */
  Orphan: "ORPHAN",
} as const;
export type ReconciliationKind = (typeof ReconciliationKind)[keyof typeof ReconciliationKind];

export const RECONCILIATION_KIND_LABEL: Record<ReconciliationKind, string> = {
  CORE_ACCOUNT_UNDISBURSED: "Open in core, not disbursed",
  CORE_ACCOUNT_PAID_UNRECORDED: "Paid in core, not recorded",
  LENDING_ACCOUNT_MISSING_IN_CORE: "Missing in core",
  ACCOUNT_MISMATCH: "Account differs",
  PAYMENT_MISMATCH: "Payment differs",
  ORPHAN: "Unknown to lending",
};

export interface ReconciliationFinding {
  kind: ReconciliationKind;
  idempotencyKey: string;
  caseId: string | null;
  caseReference: string | null;
  coreAccountNumber: string | null;
  lendingAccountNumber: string | null;
  coreAmount: string | null;
  lendingAmount: string | null;
  /** What it means and what to do, in words. */
  detail: string;
}

export interface ReconciliationSummary {
  /** Booking requests lending holds. */
  bookingRequests: number;
  /** Booking requests whose account core confirms and lending recorded the same. */
  matched: number;
  coreAccounts: number;
  payments: number;
  findings: number;
  /** More than one core account for one application. */
  duplicates: number;
  /** Bookings that completed while the run read the feeds (not reported as findings). */
  settledDuringRun: number;
}

export interface ReconciliationRunView {
  id: string;
  runAt: string;
  runByName: string;
  /** The providers' mode (SIMULATED in this release). */
  providerMode: string;
  summary: ReconciliationSummary;
  findings: ReconciliationFinding[];
}

/** One run in the history (no findings). */
export interface ReconciliationRunSummaryView {
  id: string;
  runAt: string;
  runByName: string;
  summary: ReconciliationSummary;
}

/** A count with its share of a total (share is a decimal string such as "0.6400"). */
export interface ReportCount {
  key: string;
  /** Words for the key, when the record stores them (a reason code's staff wording). */
  label?: string;
  count: number;
  share: string;
}

export interface ReportPeriod {
  /** Inclusive business dates (Philippines, UTC+8). */
  from: string;
  to: string;
}

/** RPT-003: decisions made in the period. */
export interface DecisionMixReport {
  period: ReportPeriod;
  decisions: number;
  /** AUTO_APPROVE, REFER, AUTO_DECLINE. */
  outcomes: ReportCount[];
  /** Decided with no human touch (auto-approve or auto-decline) over all decisions. */
  straightThroughRate: string;
  /** Reason codes on the decisions (one decision can carry several). */
  reasonCodes: ReportCount[];
  /** Referral triggers on the referred decisions. */
  referralTriggers: ReportCount[];
  /** Recommendations made on cases submitted in the period. */
  recommendations: number;
  overrides: number;
  overrideRate: string;
  overrideReasons: ReportCount[];
}

export interface FunnelStage {
  key: "STARTED" | "SUBMITTED" | "APPROVED" | "DISBURSED";
  count: number;
  /** Share of the stage before it (the first stage: of itself). */
  conversion: string;
}

/** RPT-001: applications started in the period and how far they got. */
export interface OriginationFunnelReport {
  period: ReportPeriod;
  stages: FunnelStage[];
  /** Sum of the principals disbursed (decimal string). */
  disbursedAmount: string;
  /** Where the period's applications are now, by case status. */
  byStatus: ReportCount[];
}

export interface LatestReconciliationView {
  /** Null before the first run. */
  run: ReconciliationRunView | null;
}
