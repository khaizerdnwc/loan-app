/**
 * The lending vocabulary shared by the API and the backoffice: roles, case statuses,
 * outcomes and grades. Values are strings so they read well in the database, the API and
 * the activity history.
 */

export const Role = {
  LoanOfficer: "LOAN_OFFICER",
  Approver: "APPROVER",
  LoanOperations: "LOAN_OPERATIONS",
  LoanOperationsSupervisor: "LOAN_OPERATIONS_SUPERVISOR",
  Compliance: "COMPLIANCE",
  Admin: "ADMIN",
} as const;
export type Role = (typeof Role)[keyof typeof Role];

export const ROLE_LABEL: Record<Role, string> = {
  LOAN_OFFICER: "Loan officer",
  APPROVER: "Approver",
  LOAN_OPERATIONS: "Loan operations",
  LOAN_OPERATIONS_SUPERVISOR: "Loan operations supervisor",
  COMPLIANCE: "Compliance / audit",
  ADMIN: "Administrator",
};

export const CaseStatus = {
  Draft: "DRAFT",
  Review: "REVIEW",
  InfoRequested: "INFO_REQUESTED",
  Approval: "APPROVAL",
  Offer: "OFFER",
  Booking: "BOOKING",
  PendingChecker: "PENDING_CHECKER",
  BookingFailed: "BOOKING_FAILED",
  Disbursed: "DISBURSED",
  Declined: "DECLINED",
  Withdrawn: "WITHDRAWN",
  Expired: "EXPIRED",
} as const;
export type CaseStatus = (typeof CaseStatus)[keyof typeof CaseStatus];

/**
 * Statuses a case never leaves: a closed case no longer counts as the applicant's open
 * application (INT-007). The lifecycle draws no edge out of any of them.
 */
export const CLOSED_CASE_STATUSES: readonly CaseStatus[] = [
  CaseStatus.Declined,
  CaseStatus.Disbursed,
  CaseStatus.Withdrawn,
  CaseStatus.Expired,
];

/** Every case status in lifecycle order (the declaration order above). */
export const CASE_STATUSES: readonly CaseStatus[] = Object.values(CaseStatus);

export const STATUS_LABEL: Record<CaseStatus, string> = {
  DRAFT: "Draft",
  REVIEW: "In review",
  INFO_REQUESTED: "Information requested",
  APPROVAL: "Awaiting approval",
  OFFER: "Offer · awaiting signature",
  BOOKING: "Ready to book",
  PENDING_CHECKER: "Awaiting checker",
  BOOKING_FAILED: "Booking failed",
  DISBURSED: "Disbursed",
  DECLINED: "Declined",
  WITHDRAWN: "Withdrawn",
  EXPIRED: "Expired",
};

/** Product display names by product code (one product in this release). */
export const PRODUCT_LABEL: Readonly<Record<string, string>> = { PL: "Personal loan" };

/** A product's display name, or its code when the code is unknown. */
export function productLabel(code: string): string {
  return PRODUCT_LABEL[code] ?? code;
}

export const DecisionOutcome = {
  Approve: "AUTO_APPROVE",
  Refer: "REFER",
  Decline: "AUTO_DECLINE",
} as const;
export type DecisionOutcome = (typeof DecisionOutcome)[keyof typeof DecisionOutcome];

export const Grade = { A: "A", B: "B", C: "C", D: "D", E: "E" } as const;
export type Grade = (typeof Grade)[keyof typeof Grade];
export const GRADES: readonly Grade[] = ["A", "B", "C", "D", "E"];

export const Recommendation = {
  Approve: "APPROVE",
  CounterOffer: "COUNTER_OFFER",
  Decline: "DECLINE",
} as const;
export type Recommendation = (typeof Recommendation)[keyof typeof Recommendation];

/** Reason codes an officer gives for a recommendation that differs from the automated one. */
export const OverrideReason = {
  VerifiedIncomeSupports: "OV01",
  StrongRelationship: "OV02",
  AdditionalDocuments: "OV03",
  ReducedExposure: "OV04",
  PolicyException: "OV05",
  RiskHigherThanScore: "OV06",
} as const;
export type OverrideReason = (typeof OverrideReason)[keyof typeof OverrideReason];

export const OVERRIDE_REASON_LABEL: Record<OverrideReason, string> = {
  OV01: "Verified income supports a different amount",
  OV02: "Strong deposit relationship with WhiteBank",
  OV03: "Additional documents reduce risk",
  OV04: "Lower amount or shorter tenor reduces exposure",
  OV05: "Policy exception approved by credit policy",
  OV06: "Risk higher than the score suggests",
};

/** Reason codes an approver gives when declining. */
export const DeclineReason = {
  InsufficientIncome: "DR01",
  DebtToIncome: "DR02",
  UnableToVerify: "DR03",
  CreditHistory: "DR04",
} as const;
export type DeclineReason = (typeof DeclineReason)[keyof typeof DeclineReason];

export const DECLINE_REASON_LABEL: Record<DeclineReason, string> = {
  DR01: "Insufficient verified income",
  DR02: "Debt-to-income above policy",
  DR03: "Unable to verify information",
  DR04: "Credit history does not meet policy",
};

/** Reason codes a loan officer gives when withdrawing an application (PRD WF-012). */
export const WithdrawReason = {
  ApplicantRequest: "APPLICANT_REQUEST",
  DuplicateApplication: "DUPLICATE_APPLICATION",
  NotProceeding: "NOT_PROCEEDING",
} as const;
export type WithdrawReason = (typeof WithdrawReason)[keyof typeof WithdrawReason];

export const WITHDRAW_REASON_LABEL: Record<WithdrawReason, string> = {
  APPLICANT_REQUEST: "Applicant withdrew",
  DUPLICATE_APPLICATION: "Duplicate application",
  NOT_PROCEEDING: "Not proceeding (other)",
};

/**
 * Where an application came in: captured by staff at a branch, or confirmed by a loan officer
 * from an emailed bundle or a partner's file (email and file intake, PRD INT-010).
 */
export const Channel = { Branch: "BRANCH", FileIntake: "FILE_INTAKE" } as const;
export type Channel = (typeof Channel)[keyof typeof Channel];

export const CHANNEL_LABEL: Record<Channel, string> = {
  BRANCH: "Branch",
  FILE_INTAKE: "File intake",
};

/** A case's place in the loan officers' queue (PRD WF-002): HIGH cases are listed first. */
export const Priority = { Normal: "NORMAL", High: "HIGH" } as const;
export type Priority = (typeof Priority)[keyof typeof Priority];

/**
 * Documents a loan officer can request from the borrower on a referred case (PRD WF-007,
 * DOC-003; the prototype's "Request information" dialog).
 */
export const DocumentType = {
  BankStatements: "BANK_STATEMENTS_3M",
  CertificateOfEmployment: "CERTIFICATE_OF_EMPLOYMENT",
  IncomeTaxReturn: "INCOME_TAX_RETURN",
} as const;
export type DocumentType = (typeof DocumentType)[keyof typeof DocumentType];

export const DOCUMENT_TYPE_LABEL: Record<DocumentType, string> = {
  BANK_STATEMENTS_3M: "Bank statements, last 3 months",
  CERTIFICATE_OF_EMPLOYMENT: "Certificate of employment",
  INCOME_TAX_RETURN: "Latest income tax return",
};

/**
 * Where a requested document stands on the case's checklist: requested from the borrower,
 * received (uploaded, waiting for the officer), verified, or rejected (request it again).
 */
export const DocumentStatus = {
  Requested: "REQUESTED",
  Received: "RECEIVED",
  Verified: "VERIFIED",
  Rejected: "REJECTED",
} as const;
export type DocumentStatus = (typeof DocumentStatus)[keyof typeof DocumentStatus];

export const DOCUMENT_STATUS_LABEL: Record<DocumentStatus, string> = {
  REQUESTED: "Requested",
  RECEIVED: "Received, to verify",
  VERIFIED: "Verified",
  REJECTED: "Rejected",
};

/**
 * Where a provider's answer came from (PRD IH-008). Only simulated providers exist in this
 * release; sandbox and live modes are deferred (docs/ACCEPTANCE.md), so they are not
 * declared until something can produce them.
 */
export const ProviderMode = { Simulated: "SIMULATED" } as const;
export type ProviderMode = (typeof ProviderMode)[keyof typeof ProviderMode];

/** The failure modes every simulated provider supports (Engineering Standard 9). */
export const SimulationMode = {
  Ok: "OK",
  Outage: "OUTAGE",
  Timeout: "TIMEOUT",
  Malformed: "MALFORMED",
} as const;
export type SimulationMode = (typeof SimulationMode)[keyof typeof SimulationMode];

/**
 * Core banking adds one mode the others cannot have: the account is created, then the
 * reply is lost (ADR 0020 R5). Typed separately so no other service can be set to it.
 */
export const CoreBankingSimulationMode = { ...SimulationMode, LostReply: "LOST_REPLY" } as const;
export type CoreBankingSimulationMode =
  (typeof CoreBankingSimulationMode)[keyof typeof CoreBankingSimulationMode];

export const ServiceName = {
  CreditBureau: "CREDIT_BUREAU",
  KycAml: "KYC_AML",
  CoreBanking: "CORE_BANKING",
  Disbursement: "DISBURSEMENT",
  ESignature: "E_SIGNATURE",
  Fraud: "FRAUD",
  DocumentIntake: "DOCUMENT_INTAKE",
  CustomerLookup: "CUSTOMER_LOOKUP",
  DocumentExtraction: "DOCUMENT_EXTRACTION",
} as const;
export type ServiceName = (typeof ServiceName)[keyof typeof ServiceName];
