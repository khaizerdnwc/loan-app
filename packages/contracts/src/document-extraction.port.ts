import type { DocumentType, IntakeSource, Money, ProviderMode } from "@loan/core";

/**
 * OCR, data extraction and bank statement analysis (PRD INT-010, DOC-002, DOC-007; §9.2 "OCR
 * and document AI", "bank statement and income analysis"; provider to be selected). It reads
 * an uploaded bundle or spreadsheet into application rows, and reads a document a borrower
 * uploaded into the figures it shows. It never decides anything: lending turns its output into
 * drafts and readings a loan officer reviews. In this release every file is synthetic and the
 * provider is simulated.
 */
export interface BundleExtractionRequest {
  /** One key per upload: a retry after a timeout reads the same file into the same rows. */
  idempotencyKey: string;
  source: IntakeSource;
  /**
   * Simulated upload only: which synthetic file the officer chose (a key of
   * `INTAKE_SAMPLE_FILES`); the source's first file when left out. A real provider receives the
   * file itself.
   */
  sampleFile?: string;
}

export interface ExtractedRow {
  /** The row in the spreadsheet, or 1 for an email bundle. */
  rowNumber: number;
  /** Where it came from, in words: "Partner spreadsheet, row 3". */
  sourceDetail: string;
  fullName: string | null;
  birthDate: string | null;
  governmentIdLast4: string | null;
  employer: string | null;
  declaredMonthlyIncome: Money | null;
  /** Read from a payslip in the bundle; null when the file had none. */
  documentMonthlyIncome: Money | null;
  amount: Money | null;
  tenorMonths: number | null;
  purpose: string | null;
}

export interface ExtractedBundle {
  provider: string;
  mode: ProviderMode;
  idempotencyKey: string;
  /** The provider's reference for this reading, e.g. OCR-B-1A2B3C4D. */
  reference: string;
  fileName: string;
  /** Identifies the file's content: the same file uploaded twice has the same fingerprint. */
  fingerprint: string;
  rows: ExtractedRow[];
  extractedAt: string;
}

export interface DocumentExtractionRequest {
  /** One key per document upload: OCR on the same upload returns the same reading. */
  idempotencyKey: string;
  applicantId: string;
  documentType: DocumentType;
  /** The document store's reference for the upload being read. */
  uploadReference: string;
}

export interface StatementAnalysis {
  salaryCredit: Money;
  monthsWithSalary: number;
  monthsCovered: number;
  recurringObligations: Money;
  averageDailyBalance: Money;
  returnedItems: number;
  riskyMerchants: boolean;
}

export interface DocumentReading {
  provider: string;
  mode: ProviderMode;
  idempotencyKey: string;
  reference: string;
  documentType: DocumentType;
  /** Monthly income the document shows; null when none could be read. */
  monthlyIncome: Money | null;
  employer: string | null;
  /** Bank statements only: the analysis of the statement lines. */
  statement: StatementAnalysis | null;
  extractedAt: string;
}

export interface DocumentExtraction {
  /** Throws ProviderUnavailableError on outage, timeout or a malformed reply. */
  extractBundle(request: BundleExtractionRequest): Promise<ExtractedBundle>;
  /** Throws ProviderUnavailableError on outage, timeout or a malformed reply. */
  readDocument(request: DocumentExtractionRequest): Promise<DocumentReading>;
}

/** Nest injection token for the DocumentExtraction port. */
export const DOCUMENT_EXTRACTION = "DOCUMENT_EXTRACTION_PORT";
