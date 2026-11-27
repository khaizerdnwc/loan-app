import type { Instalment, LoanTerms, Quote } from "@loan/contracts";
import { Money } from "@loan/core";

/**
 * The simulated core banking system's loan maths (ADR 0019). The PRD makes core the owner
 * of schedules, so this lives behind the CoreBanking port; lending only checks that what
 * core returns reconciles (R6).
 *
 * Add-on method:
 *   interest        = principal × monthlyRate × tenor, rounded half-up to the centavo, once (R3)
 *   totalRepayable  = principal + interest
 *   instalment      = totalRepayable ÷ n, truncated to the centavo; the last absorbs the rest (R4)
 *   principal part  = principal ÷ n, truncated; the last absorbs the rest (R5)
 *   interest part   = instalment − principal part
 * Every value here is non-negative, so truncation and floor agree.
 */
export function quote(terms: LoanTerms): Quote {
  assertTerms(terms);
  const { principal, monthlyRate, tenorMonths } = terms;
  const interest = principal.times(monthlyRate).times(tenorMonths).round("HALF_UP");
  const totalRepayable = principal.plus(interest);
  const regularInstalment = totalRepayable.dividedBy(tenorMonths).round("DOWN");
  const finalInstalment = totalRepayable.minus(regularInstalment.times(tenorMonths - 1));
  return { principal, interest, totalRepayable, regularInstalment, finalInstalment };
}

export function buildSchedule(terms: LoanTerms, bookingDate: string): Instalment[] {
  const q = quote(terms);
  const n = terms.tenorMonths;
  const regularPrincipal = q.principal.dividedBy(n).round("DOWN");
  const finalPrincipal = q.principal.minus(regularPrincipal.times(n - 1));

  return Array.from({ length: n }, (_, i) => {
    const last = i === n - 1;
    const amount = last ? q.finalInstalment : q.regularInstalment;
    const principal = last ? finalPrincipal : regularPrincipal;
    return {
      number: i + 1,
      dueDate: addMonths(bookingDate, i + 1),
      principal,
      interest: amount.minus(principal),
      amount,
    };
  });
}

/**
 * Same day of the month, `months` later; clamped to the last day of a shorter month
 * (31 Jan + 1 month → 28/29 Feb). Pure date arithmetic on the calendar date, no time zone.
 */
export function addMonths(isoDate: string, months: number): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(isoDate);
  if (!m) throw new Error(`"${isoDate}" is not a YYYY-MM-DD date`);
  const year = Number(m[1]);
  const month = Number(m[2]) - 1 + months;
  const day = Number(m[3]);
  const targetYear = year + Math.floor(month / 12);
  const targetMonth = month % 12;
  const lastDay = new Date(Date.UTC(targetYear, targetMonth + 1, 0)).getUTCDate();
  const d = Math.min(day, lastDay);
  return `${targetYear}-${String(targetMonth + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

function assertTerms(terms: LoanTerms): void {
  if (!Number.isInteger(terms.tenorMonths) || terms.tenorMonths < 1) {
    throw new Error(`tenor must be a whole number of months, got ${terms.tenorMonths}`);
  }
  if (!terms.principal.greaterThan(Money.zero()) || !terms.principal.isRounded()) {
    throw new Error("principal must be a positive amount in centavos");
  }
}
