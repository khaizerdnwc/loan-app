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
} from "./domain";
import type { ProblemCode } from "./problem";

/**
 * The HTTP contract between the API and the backoffice. Every amount is a decimal string
 * ("150000.00", ADR 0019 R2); every date-time is ISO 8601. The API owns these shapes; the
 * backoffice only reads them.
 */

export interface StaffView {
  id: string;
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
  signatureEnvelopeId: string | null;
  booking: BookingView | null;
  loanAccountId: string | null;
  /** What the signed-in user may do now (the API decides; the UI only shows it). */
  allowedActions: ActionAvailability[];
}

export type CaseAction =
  | "EDIT_DRAFT"
  | "SUBMIT"
  | "RECOMMEND"
  | "APPROVE"
  | "DECLINE"
  | "RETURN"
  | "SIGN"
  | "SUBMIT_BOOKING"
  | "APPROVE_BOOKING"
  | "RETRY_BOOKING"
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

export interface CreateCaseRequest {
  applicantId: string;
  amount: string;
  tenorMonths: number;
  purpose: string;
  /** Submit for decision straight away (true) or save as a draft (false). */
  submit: boolean;
}

export interface UpdateDraftRequest {
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

/** The service is in the path; the API answers VALIDATION_FAILED for a mode it does not support. */
export interface SetSimulationModeRequest {
  mode: CoreBankingSimulationMode;
}
