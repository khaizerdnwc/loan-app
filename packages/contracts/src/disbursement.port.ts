import type { Money, ProviderMode } from "@loan/core";

export interface DisbursementRequest {
  /** Same key as the booking (ADR 0020): a replay returns the same payment. */
  idempotencyKey: string;
  loanAccountNumber: string;
  amount: Money;
  /** The borrower's (simulated) deposit account. */
  destinationAccount: string;
}

export interface DisbursementReceipt {
  provider: string;
  mode: ProviderMode;
  idempotencyKey: string;
  reference: string;
  amount: Money;
  destinationAccount: string;
  disbursedAt: string;
}

export interface Disbursement {
  /** Idempotent on `idempotencyKey`. Throws ProviderUnavailableError when it cannot answer. */
  disburse(request: DisbursementRequest): Promise<DisbursementReceipt>;
}

export const DISBURSEMENT = "DISBURSEMENT_PORT";
