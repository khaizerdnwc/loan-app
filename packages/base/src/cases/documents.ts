import {
  CaseStatus,
  DOCUMENT_TYPE_LABEL,
  type DocumentAction,
  DocumentStatus,
  DocumentType,
  Role,
} from "@loan/core";

/**
 * The document checklist's rules (PRD WF-007, DOC-003), as pure functions so the case view,
 * `allowedActions` and the services that refuse share one wording (the one-gate rule). The
 * services read the documents inside their transaction, after the case row is locked; every
 * document writer takes the same lock, so the read cannot be stale.
 */

export interface ChecklistDocument {
  documentType: DocumentType;
  status: DocumentStatus;
}

/** Every document type a loan officer can ask for, in the order the dialog lists them. */
export const REQUESTABLE_TYPES: readonly DocumentType[] = Object.values(DocumentType);

/** Document types that can be asked for now: never asked, or asked and rejected. */
export function requestableTypes(docs: ChecklistDocument[]): DocumentType[] {
  return REQUESTABLE_TYPES.filter((type) => {
    const doc = docs.find((d) => d.documentType === type);
    return !doc || doc.status === DocumentStatus.Rejected;
  });
}

/**
 * Why the officer must look at the documents before moving on: a received document has not
 * been verified or rejected yet. Refuses RECOMMEND and REQUEST_INFO; null when none waits.
 */
export function unreviewedRefusal(docs: ChecklistDocument[]): string | null {
  const waiting = docs.filter((d) => d.status === DocumentStatus.Received);
  if (!waiting.length) return null;
  const names = waiting.map((d) => DOCUMENT_TYPE_LABEL[d.documentType]).join("; ");
  return `Verify or reject the received document${waiting.length > 1 ? "s" : ""} first: ${names}.`;
}

/** Why a new request cannot be sent now (unreviewed documents, or nothing left to ask), or null. */
export function requestRefusal(docs: ChecklistDocument[]): string | null {
  const unreviewed = unreviewedRefusal(docs);
  if (unreviewed) return unreviewed;
  if (!requestableTypes(docs).length) {
    return "Every document that can be requested has already been verified.";
  }
  return null;
}

/** What the signed-in role may do with one document while the case is in `caseStatus`. */
export function documentActions(
  role: Role,
  caseStatus: CaseStatus,
  doc: ChecklistDocument,
): DocumentAction[] {
  if (role !== Role.LoanOfficer) return [];
  if (doc.status === DocumentStatus.Requested && caseStatus === CaseStatus.InfoRequested) {
    return ["SIMULATE_UPLOAD"];
  }
  if (
    doc.status === DocumentStatus.Received &&
    (caseStatus === CaseStatus.Review || caseStatus === CaseStatus.InfoRequested)
  ) {
    return ["VERIFY", "REJECT"];
  }
  return [];
}
