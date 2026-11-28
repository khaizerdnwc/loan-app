import type { DocumentStatus, DocumentType, ProviderMode } from "./domain";

/**
 * The HTTP contract for email and file intake with OCR (PRD INT-010, F4) and for OCR and
 * bank statement analysis on a case's received documents (PRD DOC-002, DOC-007). Every file is
 * synthetic and every extraction simulated. OCR output is only ever a draft or a reading that
 * a loan officer reviews: it never submits an application or changes a decision. Amounts are
 * decimal strings, as everywhere on the API.
 */

/** What arrived: an emailed document bundle, or a partner's spreadsheet of applications. */
export const IntakeSource = {
  EmailBundle: "EMAIL_BUNDLE",
  PartnerSpreadsheet: "PARTNER_SPREADSHEET",
} as const;
export type IntakeSource = (typeof IntakeSource)[keyof typeof IntakeSource];

export const INTAKE_SOURCE_LABEL: Record<IntakeSource, string> = {
  EMAIL_BUNDLE: "Email bundle",
  PARTNER_SPREADSHEET: "Partner spreadsheet",
};

/** An extracted draft waits for a loan officer, who confirms it (a case draft) or discards it. */
export const IntakeDraftStatus = {
  PendingReview: "PENDING_REVIEW",
  Confirmed: "CONFIRMED",
  Discarded: "DISCARDED",
} as const;
export type IntakeDraftStatus = (typeof IntakeDraftStatus)[keyof typeof IntakeDraftStatus];

export const INTAKE_DRAFT_STATUS_LABEL: Record<IntakeDraftStatus, string> = {
  PENDING_REVIEW: "To review",
  CONFIRMED: "Draft created",
  DISCARDED: "Discarded",
};

/** What OCR found that needs a person: missing data, no customer on record, a mismatch. */
export const ExtractionFlag = {
  GovernmentIdMissing: "GOVERNMENT_ID_MISSING",
  TermsMissing: "TERMS_MISSING",
  NoCustomerMatch: "NO_CUSTOMER_MATCH",
  IncomeMismatch: "INCOME_MISMATCH",
  EmployerMismatch: "EMPLOYER_MISMATCH",
  ObligationsHigher: "OBLIGATIONS_HIGHER",
} as const;
export type ExtractionFlag = (typeof ExtractionFlag)[keyof typeof ExtractionFlag];

export const EXTRACTION_FLAG_LABEL: Record<ExtractionFlag, string> = {
  GOVERNMENT_ID_MISSING: "Government ID number missing",
  TERMS_MISSING: "Amount or tenor missing",
  NO_CUSTOMER_MATCH: "No customer record matches",
  INCOME_MISMATCH: "Income differs from the declared figure",
  EMPLOYER_MISMATCH: "Employer differs from the application",
  OBLIGATIONS_HIGHER: "Recurring obligations above those on record",
};

/** One row OCR read from an uploaded file, as extracted (null where nothing was read). */
export interface ExtractedApplicationFields {
  fullName: string | null;
  birthDate: string | null;
  governmentIdLast4: string | null;
  employer: string | null;
  /** Monthly income the applicant declared (form or spreadsheet). */
  declaredMonthlyIncome: string | null;
  /** Monthly income read from an attached payslip, when the bundle had one. */
  documentMonthlyIncome: string | null;
  amount: string | null;
  tenorMonths: number | null;
  purpose: string | null;
}

export type IntakeDraftAction = "CONFIRM" | "DISCARD";

export interface IntakeDraftView {
  id: string;
  batchReference: string;
  source: IntakeSource;
  fileName: string;
  rowNumber: number;
  /** Where in the file it came from, e.g. "Partner spreadsheet, row 3". */
  sourceDetail: string;
  extracted: ExtractedApplicationFields;
  /** The customer on record whose name, birth date and ID match; null when none does yet. */
  matchedApplicant: { id: string; fullName: string } | null;
  flags: ExtractionFlag[];
  status: IntakeDraftStatus;
  providerMode: ProviderMode;
  uploadedByName: string;
  uploadedAt: string;
  /** The case draft created from it, once confirmed. */
  case: { id: string; reference: string } | null;
  review: { byName: string; at: string; discardReason: string | null } | null;
  /** What the signed-in user may do with it now. */
  actions: IntakeDraftAction[];
}

export interface IntakeUploadRequest {
  source: IntakeSource;
}

export interface IntakeUploadView {
  reference: string;
  source: IntakeSource;
  fileName: string;
  rowCount: number;
  /** Rows with at least one flag. */
  flaggedCount: number;
  providerMode: ProviderMode;
  drafts: IntakeDraftView[];
}

/** The loan officer's reviewed terms; the government ID's last 4 when OCR could not read it. */
export interface ConfirmIntakeDraftRequest {
  amount: string;
  tenorMonths: number;
  purpose: string;
  governmentIdLast4?: string;
}

export interface DiscardIntakeDraftRequest {
  reason: string;
}

/** Bank statement analysis (PRD DOC-007): income detection, obligations, cash-flow signals. */
export interface StatementAnalysisView {
  /** Average salary credit a month. */
  salaryCredit: string;
  monthsWithSalary: number;
  monthsCovered: number;
  recurringObligations: string;
  averageDailyBalance: string;
  returnedItems: number;
  /** Payments to gambling or online lending apps were found. */
  riskyMerchants: boolean;
}

export interface DocumentExtractionView {
  reference: string;
  documentType: DocumentType;
  attempt: number;
  uploadReference: string;
  providerMode: ProviderMode;
  monthlyIncome: string | null;
  employer: string | null;
  statement: StatementAnalysisView | null;
  /** The figures on the application it was compared with, as they stood then. */
  compared: { monthlyIncome: string; monthlyObligations: string; employer: string };
  flags: ExtractionFlag[];
  extractedByName: string;
  extractedAt: string;
}

/** One received document of a case and its OCR reading. */
export interface CaseExtractionLine {
  documentType: DocumentType;
  documentStatus: DocumentStatus;
  attempt: number;
  uploadReference: string | null;
  /** The reading of the current upload, or null before OCR ran on it. */
  extraction: DocumentExtractionView | null;
  /** Whether the caller may run OCR on it now (null: not offered to the role). */
  extract: { enabled: boolean; detail: string | null } | null;
}

export interface CaseExtractionsView {
  caseId: string;
  lines: CaseExtractionLine[];
}
