import type { Money, ProviderMode } from "@loan/core";

/**
 * Core banking owns the loan account and its repayment schedule (PRD: "Lending never
 * calculates repayment schedules … as a system of record"). Lending asks core for quotes
 * and books through it; the rounding rule core applies is ADR 0019.
 */
export interface LoanTerms {
  principal: Money;
  /** Add-on monthly rate as a decimal string, e.g. "0.0160". */
  monthlyRate: string;
  tenorMonths: number;
}

export interface Quote {
  /** Where the quote came from: a simulated core labels it SIMULATED. */
  mode: ProviderMode;
  principal: Money;
  interest: Money;
  totalRepayable: Money;
  regularInstalment: Money;
  finalInstalment: Money;
}

export interface Instalment {
  number: number;
  /** ISO date (YYYY-MM-DD). */
  dueDate: string;
  principal: Money;
  interest: Money;
  amount: Money;
}

export interface BookingRequest {
  /** One key per booking (ADR 0020). A replay with the same key returns the same account. */
  idempotencyKey: string;
  applicationId: string;
  customerRef: string;
  terms: LoanTerms;
  /** ISO date the loan starts; the first instalment falls one month later. */
  bookingDate: string;
}

export interface CoreLoanAccount {
  provider: string;
  mode: ProviderMode;
  idempotencyKey: string;
  accountNumber: string;
  principal: Money;
  interest: Money;
  totalRepayable: Money;
  schedule: Instalment[];
  openedAt: string;
}

export interface CoreBanking {
  /**
   * Quote the repayment for the terms without opening anything. Throws
   * ProviderUnavailableError on outage, timeout or a malformed reply.
   */
  quote(terms: LoanTerms): Promise<Quote>;
  /**
   * Create the loan account. Idempotent on `idempotencyKey`. Throws
   * ProviderUnavailableError on outage, timeout or a malformed reply — in which case the
   * account may or may not exist in core; a retry with the same key resolves it.
   */
  bookLoan(request: BookingRequest): Promise<CoreLoanAccount>;
}

export const CORE_BANKING = "CORE_BANKING_PORT";
