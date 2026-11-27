import type {
  CaseStatus,
  CoreBankingSimulationMode,
  DecisionOutcome,
  DeclineReason,
  Grade,
  OverrideReason,
  ProviderMode,
  Recommendation,
  Role,
  ServiceName,
  SimulationMode,
  WithdrawReason,
} from "./domain";
import type { ProblemCode } from "./problem";

/**
 * The HTTP contract between the API and the backoffice. Every amount is a decimal string
 * ("150000.00", ADR 0019 R2); every date-time is ISO 8601. The API owns these shapes; the
 * backoffice only reads them.
 */

export interface StaffView {
  id: string;
  /** Test sign-in name. */
  username: string;
  fullName: string;
  role: Role;
  title: string;
  /** Approvers only. */
  approvalLimit: string | null;
  approvalGrades: Grade[] | null;
}

export interface ApplicantView {
  id: string;
  fullName: string;
  birthDate: string;
  ageYears: number;
  employer: string;
  employmentMonths: number;
  relationshipMonths: number;
  monthlyIncome: string;
  monthlyObligations: string;
  depositAccount: string;
  governmentIdMasked: string;
}

export interface ProductView {
  code: string;
  name: string;
  minAmount: string;
  maxAmount: string;
  minTenorMonths: number;
  maxTenorMonths: number;
  autoApprovalLimit: string;
  monthlyRateByGrade: Record<Grade, string>;
}

export interface CaseSummary {
  id: string;
  reference: string;
  applicantName: string;
  productCode: string;
  requestedAmount: string;
  requestedTenorMonths: number;
  status: CaseStatus;
  outcome: DecisionOutcome | null;
  grade: Grade | null;
  escalated: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface RuleResultView {
  id: string;
  name: string;
  kind: "KNOCKOUT" | "REFERRAL";
  result: "PASS" | "FAIL" | "NOT_EVALUATED";
  value: string;
}

export interface ReasonCodeView {
  code: string;
  staff: string;
  borrower: string;
}

export interface DecisionRecordView {
  id: string;
  caseId: string;
  outcome: DecisionOutcome;
  score: number | null;
  grade: Grade | null;
  ruleSetVersion: string;
  scorecardVersion: string;
  ruleResults: RuleResultView[];
  scoreContributions: { factor: string; detail: string; points: number }[];
  reasonCodes: ReasonCodeView[];
  referralTriggers: string[];
  debtToIncome: string | null;
  monthlyRate: string | null;
  providerMode: ProviderMode;
  inputs: unknown;
  inputsHash: string;
  createdAt: string;
}

export interface ReproduceResult {
  decisionId: string;
  match: boolean;
  /** Fields that differ between the stored and the replayed result (empty on a match). */
  differences: string[];
  inputsHashMatches: boolean;
}

export interface ActivityView {
  id: string;
  actorName: string;
  actorRole: Role | "SYSTEM";
  action: string;
  summary: string;
  fromStatus: CaseStatus | null;
  toStatus: CaseStatus | null;
  details: Record<string, unknown>;
  createdAt: string;
}

export interface ScheduleLineView {
  number: number;
  dueDate: string;
  principal: string;
  interest: string;
  amount: string;
}

export interface LoanAccountView {
  id: string;
  coreAccountNumber: string;
  principal: string;
  interest: string;
  totalRepayable: string;
  monthlyRate: string;
  tenorMonths: number;
  openedAt: string;
  providerMode: ProviderMode;
  /** Σ instalments = principal + interest, checked when the account was stored. */
  reconciled: boolean;
  schedule: ScheduleLineView[];
  disbursement: {
    reference: string;
    amount: string;
    destinationAccount: string;
    disbursedAt: string;
  } | null;
}

export interface BookingView {
  status: "PENDING" | "BOOKED" | "FAILED";
  makerId: string;
  makerName: string;
  checkerId: string | null;
  idempotencyKey: string;
  attempts: number;
  /** Why the last attempt failed, as a stable code; never a provider's raw reply. */
  lastErrorCode: ProblemCode | null;
  /** A staff-readable sentence written by the API. */
  lastErrorDetail: string | null;
}

/**
 * One action the signed-in user might take on a case. Listed but disabled when the role is
 * right but a server-side rule refuses it now (authority limit, maker-checker), so the UI
 * can say why — the API is the only place those rules are decided.
 */
export type ActionAvailability =
  | { action: CaseAction; enabled: true }
  | { action: CaseAction; enabled: false; blockedBy: ProblemCode; detail: string };

export interface CaseDetail extends CaseSummary {
  applicant: ApplicantView;
  purpose: string;
  createdBy: string;
  decision: DecisionRecordView | null;
  recommendation: {
    by: string;
    byName: string;
    type: Recommendation;
    amount: string | null;
    tenorMonths: number | null;
    isOverride: boolean;
    overrideReason: OverrideReason | null;
    rationale: string | null;
  } | null;
  approved: {
    by: string | null;
    amount: string;
    tenorMonths: number;
    monthlyRate: string;
    /** Indicative repayment from core banking's quote. */
    regularInstalment: string | null;
  } | null;
  /** An approver's decline; automated declines are explained by `decision.reasonCodes`. */
  decline: {
    by: string;
    byName: string;
    reasonCode: DeclineReason;
    note: string | null;
  } | null;
  /** The loan officer's withdrawal (PRD WF-012), or null if the case was not withdrawn. */
  withdrawal: {
    reasonCode: WithdrawReason;
    note: string | null;
    by: string;
    byName: string;
    at: string;
  } | null;
  /** For a withdrawn or expired case, the status it was in when it closed; otherwise null. */
  closedFrom: CaseStatus | null;
  /**
   * When a draft (DRAFT_EXPIRY_DAYS after its last change) or an offer (OFFER_EXPIRY_DAYS
   * after it was made) expires; null in every other status.
   */
  expiresAt: string | null;
  signatureEnvelopeId: string | null;
  /** The latest consent recorded for this application, or null if none yet. */
  consent: ConsentView | null;
  booking: BookingView | null;
  loanAccountId: string | null;
  /**
   * The pre-booking checklist (PRD BKG-001) from BOOKING on (BOOKING, PENDING_CHECKER,
   * BOOKING_FAILED); null in every other status. SUBMIT_BOOKING is refused until every item passes.
   */
  bookingChecklist: BookingCheckView[] | null;
  /**
   * Before a decision (no decision record yet), the indicative monthly repayment for the
   * requested terms at grade C pricing (`INDICATIVE_GRADE` in packages/base), quoted by core banking (PRD INT-004); else null.
   */
  indicativeRepayment: IndicativeRepaymentView | null;
  /** What the signed-in user may do now (the API decides; the UI only shows it). */
  allowedActions: ActionAvailability[];
}

/** The items of the pre-booking checklist (PRD BKG-001; prototype booking screen). */
export type BookingCheck =
  | "APPROVALS_COMPLETE"
  | "DOCUMENTS_SIGNED"
  | "KYC_VALID"
  | "DISBURSEMENT_ACCOUNT_VERIFIED";

export interface BookingCheckView {
  check: BookingCheck;
  label: string;
  passed: boolean;
  /** What was checked, or why it fails, in staff words. */
  detail: string;
}

/**
 * An indicative repayment: what the borrower would pay a month for the requested terms at
 * one fixed grade's pricing (C), before any decision. Core banking quotes it; when core cannot
 * answer, `status` is UNAVAILABLE and the amounts are null. Never an offer.
 */
export interface IndicativeRepaymentView {
  status: "QUOTED" | "UNAVAILABLE";
  amount: string;
  tenorMonths: number;
  grade: Grade;
  /** The add-on monthly rate at that grade, e.g. "0.0160". */
  monthlyRate: string;
  regularInstalment: string | null;
  finalInstalment: string | null;
  totalRepayable: string | null;
  /** Where the quote came from (always SIMULATED in this release); null when unavailable. */
  providerMode: ProviderMode | null;
}

export type CaseAction =
  | "EDIT_DRAFT"
  | "SUBMIT"
  | "REDECIDE"
  | "RECOMMEND"
  | "APPROVE"
  | "DECLINE"
  | "RETURN"
  | "SIGN"
  | "SUBMIT_BOOKING"
  | "APPROVE_BOOKING"
  | "RETRY_BOOKING"
  | "WITHDRAW"
  | "REPRODUCE_DECISION";

interface SimulationServiceBase {
  label: string;
  resetsAt: string | null;
  setBy: string | null;
}

/** Discriminated on the service, so LOST_REPLY is only ever a core banking mode. */
export type SimulationServiceView =
  | (SimulationServiceBase & {
      service: "CORE_BANKING";
      mode: CoreBankingSimulationMode;
      supportedModes: CoreBankingSimulationMode[];
    })
  | (SimulationServiceBase & {
      service: Exclude<ServiceName, "CORE_BANKING">;
      mode: SimulationMode;
      supportedModes: SimulationMode[];
    });

export interface CaseList {
  items: CaseSummary[];
}

// --- Request bodies ----------------------------------------------------------------------

/** The terms and conditions version the applicant agrees to in this release. */
export const CONSENT_TERMS_VERSION = "1.0";

/** A draft unchanged for this many days expires (PRD INT-003), counted from its last change. */
export const DRAFT_EXPIRY_DAYS = 30;

/** An offer not signed this many days after it was made expires (prototype workflow). */
export const OFFER_EXPIRY_DAYS = 5;

/** The applicant's consents, captured by staff on their behalf (PRD INT-006). */
export interface ConsentInput {
  /** Consent to a credit bureau check. */
  creditBureauCheck: boolean;
  /** Consent to processing under the Data Privacy Act. */
  dataProcessing: boolean;
  /** The terms and conditions version agreed to (CONSENT_TERMS_VERSION). */
  termsVersion: string;
}

export interface ConsentView extends ConsentInput {
  channel: string;
  capturedBy: string;
  capturedByName: string;
  capturedAt: string;
  /** Both consents given and the current terms version: the case may be submitted. */
  complete: boolean;
}

export interface CreateCaseRequest {
  applicantId: string;
  amount: string;
  tenorMonths: number;
  purpose: string;
  /** Submit for decision straight away (true) or save as a draft (false). */
  submit: boolean;
  /** Required before the case can be submitted; a draft may be saved without it. */
  consent?: ConsentInput;
}

export interface UpdateDraftRequest {
  /** Record (or correct) the applicant's consents on the draft. */
  consent?: ConsentInput;
  amount?: string;
  tenorMonths?: number;
  purpose?: string;
}

export interface RecommendRequest {
  type: Recommendation;
  amount?: string;
  tenorMonths?: number;
  overrideReason?: OverrideReason;
  rationale: string;
}

export interface DeclineRequest {
  reasonCode: DeclineReason;
  note?: string;
}

/** The loan officer closes an application before it is booked (PRD WF-012). */
export interface WithdrawRequest {
  reasonCode: WithdrawReason;
  note?: string;
}

/** The service is in the path; the API answers VALIDATION_FAILED for a mode it does not support. */
export interface SetSimulationModeRequest {
  mode: CoreBankingSimulationMode;
}
