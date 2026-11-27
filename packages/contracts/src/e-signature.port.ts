import type { ProviderMode } from "@loan/core";

export interface SignatureRequest {
  /**
   * One key per signing request: after a timeout the envelope may already exist, so a
   * retry with the same key returns it instead of sending a second one.
   */
  idempotencyKey: string;
  applicationId: string;
  signerName: string;
  /** What is signed, e.g. "Loan agreement and disclosure statement". */
  documentTitle: string;
}

export interface SignatureResult {
  provider: string;
  mode: ProviderMode;
  idempotencyKey: string;
  envelopeId: string;
  signedAt: string;
}

export interface ESignature {
  /**
   * Collect the borrower's signature. In this release the borrower side is simulated, so
   * the simulated provider completes immediately. Idempotent on `idempotencyKey`. Throws
   * ProviderUnavailableError when it cannot answer.
   */
  sign(request: SignatureRequest): Promise<SignatureResult>;
}

export const E_SIGNATURE = "E_SIGNATURE_PORT";
