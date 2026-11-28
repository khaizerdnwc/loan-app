import type { Money, ProviderMode } from "@loan/core";

/**
 * Core banking's customer record (PRD INT-002): the facts that pre-fill a staff-assisted
 * application for an existing WhiteBank customer. Read-only; nothing is written to core.
 */
export interface CoreCustomer {
  provider: string;
  mode: ProviderMode;
  customerNumber: string;
  fullName: string;
  /** ISO date (YYYY-MM-DD). */
  birthDate: string;
  governmentIdLast4: string;
  employer: string;
  employmentMonths: number;
  /** Salary credits core sees each month: the verified income. */
  monthlyIncome: Money;
  monthlyObligations: Money;
  relationshipMonths: number;
  depositAccount: string;
}

export interface CustomerLookup {
  /**
   * The customer with this number, or null when core has none. Throws
   * ProviderUnavailableError on outage, timeout or a malformed reply.
   */
  find(customerNumber: string): Promise<CoreCustomer | null>;
}

export const CUSTOMER_LOOKUP = "CUSTOMER_LOOKUP_PORT";
