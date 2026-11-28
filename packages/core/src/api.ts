import type { AutomationMode } from "./automation";
import type {
  CaseStatus,
  Channel,
  CoreBankingSimulationMode,
  DecisionOutcome,
  DeclineReason,
  DocumentStatus,
  DocumentType,
  Grade,
  OverrideReason,
  Priority,
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
  /**
   * Why the decision went the way it did, in one line (the prototype queue's Reason column):
   * the first referral trigger, or the first reason of an automatic decline; null otherwise.
   */
  reason: string | null;
  /** How many such reasons the decision gave (0 when `reason` is null). */
  reasonCount: number;
  grade: Grade | null;
  escalated: boolean;
  /** The loan officer who owns the case (PRD WF-002); null = unassigned in the team queue. */
  ownerId: string | null;
  ownerName: string | null;
  channel: Channel;
  priority: Priority;
  createdAt: string;
  updatedAt: string;
}

export interface RuleResultView {
  id: string;
  name: string;
  /** WARNING (RS-PL-5 on): shown to the reviewer and approver, never changes the outcome. */
  kind: "KNOCKOUT" | "REFERRAL" | "WARNING";
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
  /** The product's automation mode when this decision was made (PRD §7.5). */
  automationMode: AutomationMode;
  /** Whether the product's kill switch was on. */
  killSwitch: boolean;
  /** What the rules and score decided, before the mode applied (`outcome` is what the case did). */
  engineOutcome: DecisionOutcome;
  /** 12-month probability of default for the grade (decimal string); null before SC-PL-2 or without a grade. */
  pd: string | null;
  /** The largest affordable amount up to the one requested; null before RS-PL-3 or without a grade. */
  recommendedAmount: string | null;
  /** Milliseconds from gathering the inputs to writing this record; null on older records. */
  latencyMs: number | null;
  /**
   * The score band edges of the record's own rule set: decline below `declineBelow`, approve
   * from `approveFrom`, refer between. Sent with every record so no screen keeps its own table.
   * Null only if the record names a rule set this API does not know (it is shown without a band).
   */
  scoreBand: { declineBelow: number; approveFrom: number } | null;
  /**
   * The external decision engine's part in this decision (PRD DEC-008), from the stored
   * inputs; null when none was used (role NONE, or a record from before RS-PL-4). `outcome` and
   * `reference` are null when the engine could not answer. `agreed` (ALONGSIDE only) says
   * whether it agreed with the built-in engine; null for INSTEAD, unanswered or knocked out.
   */
  externalEngine: {
    role: "ALONGSIDE" | "INSTEAD";
    outcome: DecisionOutcome | null;
    reference: string | null;
    agreed: boolean | null;
  } | null;
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
  | {
      action: CaseAction;
      enabled: true;
      /**
       * REQUEST_INFO only: the document types the API will accept in a request now (never
       * asked, or rejected). The dialog offers exactly these.
       */
      documentTypes?: DocumentType[];
    }
  | { action: CaseAction; enabled: false; blockedBy: ProblemCode; detail: string };

/** A recommendation type the loan officer may send now, or why the API refuses it. */
export type RecommendationAvailability =
  | { type: Recommendation; enabled: true }
  | { type: Recommendation; enabled: false; blockedBy: ProblemCode; detail: string };

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
  /**
   * The latest request for information sent to the borrower (PRD WF-007), or null if none.
   * Open while the case is INFO_REQUESTED.
   */
  infoRequest: InfoRequestView | null;
  /** The case's document checklist (PRD DOC-003): every document requested so far. */
  documents: CaseDocumentView[];
  /**
   * While awaiting approval (APPROVAL), the monthly repayment for the recommended terms at the
   * case's grade and rate, quoted by core banking, so the approver sees what they approve
   * (prototype approve dialog); UNAVAILABLE when core cannot answer; else null.
   */
  proposedRepayment: IndicativeRepaymentView | null;
  /** What the signed-in user may do now (the API decides; the UI only shows it). */
  allowedActions: ActionAvailability[];
  /** The current decision was made while a provider could not answer (bureau, screening, fraud). */
  decidedDuringOutage: boolean;
  /**
   * When RECOMMEND is offered: each recommendation type and whether the API accepts it now
   * (only a decline after an outage or a failed knockout). Empty otherwise.
   */
  recommendationTypes: RecommendationAvailability[];
}

export interface InfoRequestView {
  documents: DocumentType[];
  /** The message the borrower sees. */
  message: string;
  /** The business date (YYYY-MM-DD) the borrower is asked to answer by; shown, not enforced. */
  dueOn: string;
  requestedBy: string;
  requestedByName: string;
  requestedAt: string;
}

/** What the signed-in user may do with one document now (the API decides). */
export type DocumentAction = "SIMULATE_UPLOAD" | "VERIFY" | "REJECT";

export interface CaseDocumentView {
  type: DocumentType;
  status: DocumentStatus;
  requestedAt: string;
  /** Synthetic metadata from the simulated upload; null until the borrower uploads. */
  upload: {
    reference: string;
    fileName: string;
    contentType: string;
    sizeBytes: number;
    pages: number;
    virusScan: "CLEAN";
    receivedAt: string;
    providerMode: ProviderMode;
  } | null;
  /** The loan officer's verification or rejection; null until reviewed. */
  review: {
    by: string;
    byName: string;
    at: string;
    rejectionReason: string | null;
  } | null;
  actions: DocumentAction[];
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
  | "REQUEST_INFO"
  | "PICK"
  | "REASSIGN"
  | "SET_PRIORITY"
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

/** Ask the borrower for documents on a referred case (PRD WF-007): REVIEW → INFO_REQUESTED. */
export interface InfoRequestRequest {
  documents: DocumentType[];
  message: string;
  /** Days until the answer is due (3 or 5, the prototype's choices). */
  dueInDays: 3 | 5;
}

/** The loan officer's verdict on a received document. */
export interface DocumentReviewRequest {
  decision: "VERIFIED" | "REJECTED";
  /** Required when rejecting: what is wrong, so the borrower can be asked again. */
  reason?: string;
}

/** Hand a case to another loan officer (PRD WF-002). */
export interface ReassignRequest {
  ownerId: string;
  reason: string;
}

export interface SetPriorityRequest {
  priority: Priority;
}

/** A loan officer a case can be handed to. */
export interface LoanOfficerView {
  id: string;
  fullName: string;
  /** Open cases (draft, review, information requested) this officer owns now. */
  openCases: number;
}

/**
 * A customer as simulated core banking knows them (PRD INT-002): the facts that pre-fill a
 * walk-in capture. Labelled with the provider mode; amounts are decimal strings.
 */
export interface CoreCustomerView {
  customerNumber: string;
  fullName: string;
  birthDate: string;
  governmentIdLast4: string;
  employer: string;
  employmentMonths: number;
  /** Salary credits core sees each month: the verified income. */
  monthlyIncome: string;
  monthlyObligations: string;
  relationshipMonths: number;
  depositAccount: string;
  providerMode: ProviderMode;
  /** The applicant already on file for this customer, if any. */
  applicantId: string | null;
}

/**
 * A new applicant captured by a loan officer (PRD INT-005): a walk-in new to the bank, or an
 * existing customer found in core (`customerNumber`), whose identity, account and relationship
 * then come from core, not from this body.
 */
export interface NewApplicantRequest {
  customerNumber?: string;
  fullName: string;
  birthDate: string;
  governmentIdLast4: string;
  employer: string;
  employmentMonths: number;
  /** Declared monthly income. */
  monthlyIncome: string;
  monthlyObligations: string;
}

/** The service is in the path; the API answers VALIDATION_FAILED for a mode it does not support. */
export interface SetSimulationModeRequest {
  mode: CoreBankingSimulationMode;
}
