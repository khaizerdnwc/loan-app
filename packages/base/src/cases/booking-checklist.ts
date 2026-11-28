import { type BookingCheckView, CaseStatus, type Money } from "@loan/core";
import type { DecisionInputs } from "../decisioning/engine";
import { accountFromSystemOfRecord } from "./applicant-source";
import { businessDate } from "./product";

/**
 * The pre-booking checklist (PRD BKG-001; the prototype's booking screen `checklist(a)`):
 * approvals complete, documents signed, KYC valid, disbursement account verified. One pure
 * function computes it for the case view, for the disabled SUBMIT_BOOKING and for the API's
 * 409 (evaluated inside the booking transaction, after the row lock), so the screen and the
 * refusal can never disagree (the one-gate rule).
 */

/** KYC screening older than this many months does not count as valid at booking (prototype). */
export const KYC_VALIDITY_MONTHS = 12;

/** A WhiteBank deposit account as core banking issues it (seed: WB-SAV-0021-4410). */
const WHITEBANK_DEPOSIT_ACCOUNT = /^WB-SAV-\d{4}-\d{4}$/;

/** Statuses that show the checklist: the booking step and after it, until the loan is booked. */
const CHECKLIST_STATUSES: readonly CaseStatus[] = [
  CaseStatus.Booking,
  CaseStatus.PendingChecker,
  CaseStatus.BookingFailed,
];

export interface ChecklistCase {
  status: CaseStatus;
  approvedAmount: Money | null;
  approvedTenorMonths: number | null;
  approvedMonthlyRate: string | null;
  approvedBy: string | null;
  signatureEnvelopeId: string | null;
  applicant: { id: string; customerNumber: string | null; depositAccount: string };
}

/** The decision record's screening and when it ran (the record is written at screening). */
export interface ChecklistDecision {
  inputs: Pick<DecisionInputs, "screening">;
  createdAt: Date;
}

/** The checklist for a case at `now`, or null outside the booking step. */
export function bookingChecklist(
  c: ChecklistCase,
  decision: ChecklistDecision | null,
  now: Date,
): BookingCheckView[] | null {
  if (!CHECKLIST_STATUSES.includes(c.status)) return null;
  return [approvals(c), signed(c), kyc(decision, now), account(c)];
}

/**
 * Why SUBMIT_BOOKING is refused: the first failing item, in the one wording the API's 409 and
 * the disabled action both use; null when every item passes.
 */
export function checklistRefusal(items: BookingCheckView[] | null): string | null {
  const failing = items?.find((i) => !i.passed);
  if (!failing) return null;
  return `Pre-booking checklist: ${failing.label} — ${failing.detail}. The booking cannot go ahead until every item passes.`;
}

function approvals(c: ChecklistCase): BookingCheckView {
  const passed = Boolean(c.approvedAmount && c.approvedTenorMonths && c.approvedMonthlyRate);
  return {
    check: "APPROVALS_COMPLETE",
    label: "Approvals complete",
    passed,
    detail: passed
      ? `₱${c.approvedAmount?.toString()} over ${c.approvedTenorMonths} months, ${c.approvedBy ? "approved by an approver" : "approved automatically"}`
      : "No approved terms on the case",
  };
}

function signed(c: ChecklistCase): BookingCheckView {
  const passed = Boolean(c.signatureEnvelopeId);
  return {
    check: "DOCUMENTS_SIGNED",
    label: "Documents signed",
    passed,
    detail: passed
      ? `Loan agreement e-signed by the borrower (envelope ${c.signatureEnvelopeId}, simulated)`
      : "The borrower's signature is outstanding",
  };
}

function kyc(decision: ChecklistDecision | null, now: Date): BookingCheckView {
  const fail = (detail: string): BookingCheckView => ({
    check: "KYC_VALID",
    label: "KYC valid",
    passed: false,
    detail,
  });
  if (!decision) return fail("No KYC screening on record");
  const s = decision.inputs.screening;
  if (s.status !== "OK") return fail("KYC screening was unavailable when the case was decided");
  if (!s.kycVerified) return fail("Identity was not verified");
  if (s.sanctionsMatch) return fail("Sanctions or watchlist match");
  const screened = businessDate(decision.createdAt);
  const validUntil = addMonths(decision.createdAt, KYC_VALIDITY_MONTHS);
  if (validUntil.getTime() <= now.getTime()) {
    return fail(
      `Screened on ${screened}, more than ${KYC_VALIDITY_MONTHS} months ago: the applicant must be screened again`,
    );
  }
  return {
    check: "KYC_VALID",
    label: "KYC valid",
    passed: true,
    detail: `Identity verified and sanctions clear on ${screened} (valid until ${businessDate(validUntil)})`,
  };
}

function account(c: ChecklistCase): BookingCheckView {
  const number = c.applicant.depositAccount;
  // Verified only when the account comes from core's record (or a seeded persona standing in
  // for it), never from a value staff typed; the pattern alone proves nothing.
  const fromRecord = accountFromSystemOfRecord(c.applicant);
  const passed = fromRecord && WHITEBANK_DEPOSIT_ACCOUNT.test(number);
  return {
    check: "DISBURSEMENT_ACCOUNT_VERIFIED",
    label: "Disbursement account verified",
    passed,
    detail: passed
      ? `${number}, the applicant's own WhiteBank deposit account on record in core banking`
      : fromRecord
        ? "No valid WhiteBank deposit account on record for the applicant"
        : "No WhiteBank deposit account from core banking: the applicant was captured by hand as new to the bank",
  };
}

/** The same instant `months` calendar months later (UTC; Date rolls an overflowing day forward). */
function addMonths(from: Date, months: number): Date {
  const to = new Date(from.getTime());
  to.setUTCMonth(to.getUTCMonth() + months);
  return to;
}
