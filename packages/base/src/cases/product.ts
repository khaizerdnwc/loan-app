import {
  CaseStatus,
  DRAFT_EXPIRY_DAYS,
  type FieldError,
  type Grade,
  Money,
  OFFER_EXPIRY_DAYS,
  type ProductView,
} from "@loan/core";
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

/** The grade whose pricing an indicative repayment uses before a decision (prototype: grade C). */
export const INDICATIVE_GRADE: Grade = "C";

const DAY_MS = 86_400_000;

/** The moment something that started at `since` expires after `days` days. */
export function expiresAt(since: Date, days: number): Date {
  return new Date(since.getTime() + days * DAY_MS);
}

/**
 * When a case's draft or offer expires (DRAFT_EXPIRY_DAYS from the draft's `updatedAt`,
 * OFFER_EXPIRY_DAYS from `offeredAt`, both from core); null when it is neither, or an offer
 * has no date. Writes on an expired case are refused; the expiry sweep closes it.
 */
export function expiryOf(c: {
  status: CaseStatus;
  updatedAt: Date;
  offeredAt: Date | null;
}): Date | null {
  if (c.status === CaseStatus.Draft) return expiresAt(c.updatedAt, DRAFT_EXPIRY_DAYS);
  if (c.status === CaseStatus.Offer && c.offeredAt) {
    return expiresAt(c.offeredAt, OFFER_EXPIRY_DAYS);
  }
  return null;
}

/**
 * Why a write on the case is refused because its draft or offer expired at `now`, in the one
 * wording the API's 409 and the disabled action both use; null while it has not expired.
 */
export function expiryRefusal(
  c: { status: CaseStatus; updatedAt: Date; offeredAt: Date | null },
  now: Date,
): string | null {
  const until = expiryOf(c);
  if (!until || until.getTime() > now.getTime()) return null;
  return c.status === CaseStatus.Draft
    ? `This draft expired on ${businessDate(until)}: it was unchanged for ${DRAFT_EXPIRY_DAYS} days. Capture a new application.`
    : `This offer expired on ${businessDate(until)}: it was not signed within ${OFFER_EXPIRY_DAYS} days of approval.`;
}

/** The date as YYYY-MM-DD in the Philippines (UTC+8), the bank's business date. */
export function businessDate(now = new Date()): string {
  return new Date(now.getTime() + 8 * 3_600_000).toISOString().slice(0, 10);
}

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

/**
 * A request's decimal string as Money, or null when Money cannot read it ("." or "+5" pass
 * `@IsDecimal`; `Money.of` throws on them). `termErrors` then reports the amount field (400).
 */
export function parseRequestAmount(raw: string | undefined | null): Money | null {
  if (raw === undefined || raw === null || raw === "") return null;
  try {
    return Money.of(String(raw));
  } catch {
    return null;
  }
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
