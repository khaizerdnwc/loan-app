import { CaseStatus } from "@loan/core";

/**
 * The one transition table for a loan case. A status is written only here: `startDraft` for a
 * new case and `moveTo` for every change, which checks both ends of the edge, so no service can
 * move a case along an edge this table does not draw (house/no-case-status-assignment-outside-lifecycle).
 *
 *   DRAFT ──submit──▶ OFFER (auto-approve) | REVIEW (refer) | DECLINED (auto-decline)
 *   REVIEW ──re-decide (a provider was unavailable)──▶ OFFER | REVIEW | DECLINED
 *   REVIEW ──recommend──▶ APPROVAL
 *   APPROVAL ──approve──▶ OFFER · ──decline──▶ DECLINED · ──return──▶ REVIEW
 *   OFFER ──sign──▶ BOOKING
 *   BOOKING ──submit booking──▶ PENDING_CHECKER
 *   PENDING_CHECKER ──approve booking──▶ DISBURSED | BOOKING_FAILED
 *   BOOKING_FAILED ──retry──▶ DISBURSED | BOOKING_FAILED
 */
export type CaseEvent =
  | "SUBMIT"
  | "REDECIDE"
  | "RECOMMEND"
  | "APPROVE"
  | "DECLINE"
  | "RETURN"
  | "SIGN"
  | "SUBMIT_BOOKING"
  | "BOOKING_SUCCEEDED"
  | "BOOKING_FAILED";

const TRANSITIONS: Readonly<Record<CaseEvent, { from: CaseStatus[]; to: CaseStatus[] }>> = {
  SUBMIT: {
    from: [CaseStatus.Draft],
    to: [CaseStatus.Offer, CaseStatus.Review, CaseStatus.Declined],
  },
  REDECIDE: {
    from: [CaseStatus.Review],
    to: [CaseStatus.Offer, CaseStatus.Review, CaseStatus.Declined],
  },
  RECOMMEND: { from: [CaseStatus.Review], to: [CaseStatus.Approval] },
  APPROVE: { from: [CaseStatus.Approval], to: [CaseStatus.Offer] },
  DECLINE: { from: [CaseStatus.Approval], to: [CaseStatus.Declined] },
  RETURN: { from: [CaseStatus.Approval], to: [CaseStatus.Review] },
  SIGN: { from: [CaseStatus.Offer], to: [CaseStatus.Booking] },
  SUBMIT_BOOKING: { from: [CaseStatus.Booking], to: [CaseStatus.PendingChecker] },
  BOOKING_SUCCEEDED: {
    from: [CaseStatus.PendingChecker, CaseStatus.BookingFailed],
    to: [CaseStatus.Disbursed],
  },
  BOOKING_FAILED: {
    from: [CaseStatus.PendingChecker, CaseStatus.BookingFailed],
    to: [CaseStatus.BookingFailed],
  },
};

export class InvalidTransitionError extends Error {
  readonly code = "INVALID_STATE_TRANSITION";

  constructor(
    readonly event: CaseEvent,
    readonly from: CaseStatus,
    readonly to?: CaseStatus,
  ) {
    super(
      to
        ? `Cannot ${describe(event)}: a case cannot move from ${from} to ${to}.`
        : `Cannot ${describe(event)} while the case is ${from}.`,
    );
    this.name = "InvalidTransitionError";
  }
}

function describe(event: CaseEvent): string {
  return event.toLowerCase().replaceAll("_", " ");
}

/** Whether `event` may happen in `from` (used to offer actions in the UI). */
export function canHappen(event: CaseEvent, from: CaseStatus): boolean {
  return TRANSITIONS[event].from.includes(from);
}

/** Throws InvalidTransitionError unless `event` may take a case from `from` to `to`. */
export function assertTransition(event: CaseEvent, from: CaseStatus, to?: CaseStatus): void {
  const edge = TRANSITIONS[event];
  if (!edge.from.includes(from)) throw new InvalidTransitionError(event, from);
  if (to !== undefined && !edge.to.includes(to)) throw new InvalidTransitionError(event, from, to);
}

/** The status a new case starts in. */
export function startDraft(c: { status: CaseStatus }): void {
  c.status = CaseStatus.Draft;
}

/**
 * Moves the case along `event` to `to`, or throws InvalidTransitionError if the table has no
 * such edge from its current status. The only way a case's status changes.
 */
export function moveTo(c: { status: CaseStatus }, event: CaseEvent, to: CaseStatus): void {
  assertTransition(event, c.status, to);
  c.status = to;
}
