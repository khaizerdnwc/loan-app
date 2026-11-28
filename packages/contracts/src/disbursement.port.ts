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

/** One payment as the rail's payment feed lists it (for reconciliation, PRD BKG-005). */
export interface PaymentRecord {
  mode: ProviderMode;
  idempotencyKey: string;
  reference: string;
  loanAccountNumber: string;
  amount: Money;
  disbursedAt: string;
}

export interface Disbursement {
  /** Idempotent on `idempotencyKey`. Throws ProviderUnavailableError when it cannot answer. */
  disburse(request: DisbursementRequest): Promise<DisbursementReceipt>;
  /** Every payment made (read-only). Throws ProviderUnavailableError when it cannot answer. */
  listPayments(): Promise<PaymentRecord[]>;
}

export const DISBURSEMENT = "DISBURSEMENT_PORT";
