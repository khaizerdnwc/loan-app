import type { DocumentType, ProviderMode } from "@loan/core";

/**
 * Document intake (PRD DOC-001): receives a file the borrower uploads, checks its type and
 * size, scans it, and stores it, returning a reference and the file's metadata. Lending keeps
 * only that metadata, never the file. In this release the borrower side and the store are
 * simulated, and every "file" is synthetic.
 */
export interface DocumentUploadRequest {
  /** One key per requested document and attempt: a retry after a timeout gets the same file. */
  idempotencyKey: string;
  applicationId: string;
  documentType: DocumentType;
}

export interface ReceivedDocument {
  provider: string;
  mode: ProviderMode;
  idempotencyKey: string;
  /** The store's reference for the file, e.g. DOC-00000001. */
  reference: string;
  fileName: string;
  contentType: string;
  sizeBytes: number;
  pages: number;
  /** Malware scan verdict; an infected file is refused by the provider, never returned. */
  virusScan: "CLEAN";
  receivedAt: string;
}

export interface DocumentIntake {
  /**
   * Receive the borrower's upload for a requested document. Idempotent on `idempotencyKey`.
   * Throws ProviderUnavailableError on outage, timeout or a malformed reply.
   */
  receive(request: DocumentUploadRequest): Promise<ReceivedDocument>;
}

export const DOCUMENT_INTAKE = "DOCUMENT_INTAKE_PORT";
