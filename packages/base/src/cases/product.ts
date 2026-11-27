import { type FieldError, Money, type ProductView } from "@loan/core";
import { CURRENT_RULE_SET, ruleSet } from "../decisioning/engine";

/**
 * The one seeded product (docs/ASSUMPTIONS.md): personal loan, ₱20,000–₱500,000, 6–36 whole
 * months. Limits are enforced here on the server; the form only mirrors them.
 */
export const PERSONAL_LOAN = {
  code: "PL",
  name: "Personal loan",
  minAmount: Money.of("20000.00"),
  maxAmount: Money.of("500000.00"),
  minTenorMonths: 6,
  maxTenorMonths: 36,
} as const;

export function productView(): ProductView {
  const rs = ruleSet(CURRENT_RULE_SET);
  return {
    code: PERSONAL_LOAN.code,
    name: PERSONAL_LOAN.name,
    minAmount: PERSONAL_LOAN.minAmount.toString(),
    maxAmount: PERSONAL_LOAN.maxAmount.toString(),
    minTenorMonths: PERSONAL_LOAN.minTenorMonths,
    maxTenorMonths: PERSONAL_LOAN.maxTenorMonths,
    autoApprovalLimit: rs.autoApprovalLimit,
    monthlyRateByGrade: rs.monthlyRate,
  };
}

/** Field errors for an amount and tenor against the product limits (A-1, A-2). */
export function termErrors(amount: Money | null, tenorMonths: number | null): FieldError[] {
  const errors: FieldError[] = [];
  const p = PERSONAL_LOAN;
  if (amount === null) {
    errors.push({ field: "amount", message: "Enter an amount." });
  } else if (amount.lessThan(p.minAmount) || amount.greaterThan(p.maxAmount)) {
    errors.push({ field: "amount", message: "Amount must be between ₱20,000 and ₱500,000." });
  }
  if (tenorMonths === null) {
    errors.push({ field: "tenorMonths", message: "Enter a tenor in months." });
  } else if (
    !Number.isInteger(tenorMonths) ||
    tenorMonths < p.minTenorMonths ||
    tenorMonths > p.maxTenorMonths
  ) {
    errors.push({
      field: "tenorMonths",
      message: "Tenor must be a whole number of months from 6 to 36.",
    });
  }
  return errors;
}
