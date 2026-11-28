import {
  CaseStatus,
  DOCUMENT_TYPE_LABEL,
  DocumentStatus,
  type DocumentType,
  ExtractionFlag,
  type FieldError,
  type IntakeDraftAction,
  IntakeDraftStatus,
  Money,
  Role,
} from "@loan/core";
import { normaliseName } from "../cases/applicant-identity";
import { termErrors } from "../cases/product";
import { CURRENT_RULE_SET, ruleSet } from "../decisioning/engine";

/**
 * The rules of email and file intake and of OCR on case documents (PRD INT-010, DOC-002,
 * DOC-007), as pure functions so the views, the offered actions and the services that refuse
 * share one wording.
 */

/**
 * How far an income read from a document may differ from the declared one before it is
 * flagged: the current rule set's income-mismatch tolerance (RS-PL-2: 15%), so an OCR flag
 * and the decision's referral trigger never disagree on what a mismatch is.
 */
export function mismatchTolerance(): string {
  return ruleSet(CURRENT_RULE_SET).incomeMismatchTolerance ?? "0.15";
}

/** |declared − read| > read × tolerance, exactly; a read income of zero mismatches any other. */
export function incomeMismatch(declared: Money, read: Money, tolerance: string): boolean {
  const gap = declared.greaterThan(read) ? declared.minus(read) : read.minus(declared);
  return read.isZero() ? !declared.isZero() : gap.greaterThan(read.times(tolerance));
}

/** Names are compared as everywhere an identity is (cases/applicant-identity). */
export { normaliseName };

export interface ExtractedRowFacts {
  governmentIdLast4: string | null;
  amount: Money | null;
  tenorMonths: number | null;
  declaredMonthlyIncome: Money | null;
  documentMonthlyIncome: Money | null;
}

/** What a person must look at in an extracted row, given how many customers on record match it. */
export function rowFlags(
  row: ExtractedRowFacts,
  match: "none" | "one" | "many",
  tolerance: string,
): ExtractionFlag[] {
  const flags: ExtractionFlag[] = [];
  if (!row.governmentIdLast4) flags.push(ExtractionFlag.GovernmentIdMissing);
  if (row.amount === null || row.tenorMonths === null) {
    flags.push(ExtractionFlag.TermsMissing);
  } else if (termErrors(row.amount, row.tenorMonths).length > 0) {
    // The officer corrects the terms on review; the product limits are checked again on confirm.
    flags.push(ExtractionFlag.TermsOutsideProduct);
  }
  if (row.governmentIdLast4 && match === "none") flags.push(ExtractionFlag.NoCustomerMatch);
  if (row.governmentIdLast4 && match === "many") flags.push(ExtractionFlag.SeveralCustomersMatch);
  if (
    row.declaredMonthlyIncome &&
    row.documentMonthlyIncome &&
    incomeMismatch(row.declaredMonthlyIncome, row.documentMonthlyIncome, tolerance)
  ) {
    flags.push(ExtractionFlag.IncomeMismatch);
  }
  return flags;
}

export interface DocumentFigures {
  monthlyIncome: Money | null;
  employer: string | null;
  recurringObligations: Money | null;
}

export interface ApplicationFigures {
  monthlyIncome: Money;
  monthlyObligations: Money;
  employer: string;
}

/**
 * What OCR's reading of a document raises against the application: an income outside the
 * tolerance, another employer, or recurring obligations on the statements more than the
 * tolerance above those on record. Nothing read, nothing flagged.
 */
export function documentFlags(
  read: DocumentFigures,
  application: ApplicationFigures,
  tolerance: string,
): ExtractionFlag[] {
  const flags: ExtractionFlag[] = [];
  if (
    read.monthlyIncome &&
    incomeMismatch(application.monthlyIncome, read.monthlyIncome, tolerance)
  ) {
    flags.push(ExtractionFlag.IncomeMismatch);
  }
  if (read.employer && normaliseName(read.employer) !== normaliseName(application.employer)) {
    flags.push(ExtractionFlag.EmployerMismatch);
  }
  if (read.recurringObligations) {
    const onRecord = application.monthlyObligations;
    const higher = onRecord.isZero()
      ? read.recurringObligations.greaterThan(Money.zero())
      : read.recurringObligations.minus(onRecord).greaterThan(onRecord.times(tolerance));
    if (higher) flags.push(ExtractionFlag.ObligationsHigher);
  }
  return flags;
}

/**
 * The ID digits a confirm uses: the ones OCR read, which the officer cannot change; the officer's
 * only when the file had none. Different digits from OCR's are a field error, null when neither
 * has any (the caller asks for them).
 */
export function idDigits(
  read: string | null,
  typed: string | null,
): { digits: string | null; error: FieldError | null } {
  if (read !== null) {
    if (typed !== null && typed !== read) {
      return {
        digits: null,
        error: {
          field: "governmentIdLast4",
          message:
            "OCR read the government ID from the file, and its digits cannot be changed here. If the file is wrong, discard the draft.",
        },
      };
    }
    return { digits: read, error: null };
  }
  return { digits: typed, error: null };
}

/** What the signed-in role may do with an intake draft now. */
export function draftActions(
  role: Role,
  status: IntakeDraftStatus,
  flags: readonly ExtractionFlag[] = [],
): IntakeDraftAction[] {
  if (role !== Role.LoanOfficer || status !== IntakeDraftStatus.PendingReview) return [];
  // Several customer records match: it cannot be confirmed to one of them (the API refuses it
  // too); the officer can only discard it.
  if (flags.includes(ExtractionFlag.SeveralCustomersMatch)) return ["DISCARD"];
  return ["CONFIRM", "DISCARD"];
}

export interface ExtractableDocument {
  documentType: DocumentType;
  status: DocumentStatus;
  uploadReference: string | null;
}

/** Case statuses in which the loan officer reviews documents, so OCR may run. */
const REVIEWING: readonly CaseStatus[] = [CaseStatus.Review, CaseStatus.InfoRequested];

/**
 * Why OCR cannot run on a document now, or null when it can: the case must be in review, the
 * document received (or already verified) with an upload, and its current upload not read yet.
 */
export function extractRefusal(
  caseStatus: CaseStatus,
  doc: ExtractableDocument,
  alreadyRead: boolean,
): string | null {
  const name = DOCUMENT_TYPE_LABEL[doc.documentType];
  if (!REVIEWING.includes(caseStatus)) {
    return "Documents are read with OCR while the case is in review.";
  }
  const uploaded = doc.status === DocumentStatus.Received || doc.status === DocumentStatus.Verified;
  if (!uploaded || !doc.uploadReference) {
    return `${name} has not been received, so there is nothing to read.`;
  }
  if (alreadyRead) return `${name} has already been read with OCR.`;
  return null;
}
