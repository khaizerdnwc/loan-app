import { CaseStatus } from "@loan/core";

/**
 * Stage SLAs in Philippine business minutes (the prototype's workflow table: review 8
 * business hours, approval 4; booking 4). A stage absent here has no clock: a draft is the
 * officer's own, an information request waits on the borrower (the review clock starts again
 * when the case comes back), an offer has its own expiry (WF-012), and closed cases are done.
 */
export const SLA_POLICY: Partial<Record<CaseStatus, { minutes: number; owner: string }>> = {
  [CaseStatus.Review]: { minutes: 8 * 60, owner: "Loan officer" },
  [CaseStatus.Approval]: { minutes: 4 * 60, owner: "Approver" },
  [CaseStatus.Booking]: { minutes: 4 * 60, owner: "Loan operations" },
  [CaseStatus.PendingChecker]: { minutes: 4 * 60, owner: "Loan operations supervisor" },
  [CaseStatus.BookingFailed]: { minutes: 4 * 60, owner: "Loan operations supervisor" },
};

/** At risk: this many business minutes or fewer left (the prototype's "due within 2 hours"). */
export const AT_RISK_MINUTES = 2 * 60;
