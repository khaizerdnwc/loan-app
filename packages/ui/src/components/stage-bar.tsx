import type { CaseStatus } from "@loan/core";
import { cn } from "../lib/cn";

const STEPS = [
  "Submitted",
  "Decision",
  "Review",
  "Approval",
  "Offer",
  "Booking",
  "Disbursed",
] as const;
type Step = (typeof STEPS)[number];

/** Closed statuses with no stage of their own: they are shown where the case stopped. */
type ClosedEarly = "WITHDRAWN" | "EXPIRED";
const CLOSED_EARLY_LABEL: Record<ClosedEarly, string> = {
  WITHDRAWN: "Withdrawn",
  EXPIRED: "Expired",
};

const CURRENT: Record<Exclude<CaseStatus, ClosedEarly>, Step> = {
  DRAFT: "Submitted",
  REVIEW: "Review",
  APPROVAL: "Approval",
  OFFER: "Offer",
  BOOKING: "Booking",
  PENDING_CHECKER: "Booking",
  BOOKING_FAILED: "Booking",
  DISBURSED: "Disbursed",
  DECLINED: "Decision",
};

function isClosedEarly(status: CaseStatus): status is ClosedEarly {
  return status === "WITHDRAWN" || status === "EXPIRED";
}

/**
 * The stages a case moves through; done steps, the current one, and what is still ahead. A
 * withdrawn or expired case is shown stopped at the stage it was in (`closedFrom`, from its
 * history), the steps after it left undone; without it, at the start.
 */
export function StageBar({
  status,
  wasReferred,
  closedFrom,
}: {
  status: CaseStatus;
  wasReferred: boolean;
  /** For a withdrawn or expired case: the status it was in when it closed. */
  closedFrom?: CaseStatus | null;
}) {
  const steps = STEPS.filter((s) => wasReferred || (s !== "Review" && s !== "Approval"));
  const stoppedLabel = isClosedEarly(status) ? CLOSED_EARLY_LABEL[status] : null;
  const at: Step = isClosedEarly(status)
    ? closedFrom && !isClosedEarly(closedFrom)
      ? CURRENT[closedFrom]
      : "Submitted"
    : CURRENT[status];
  const currentIndex = steps.indexOf(at);
  return (
    <ol aria-label="Case stages" className="flex flex-wrap gap-1">
      {steps.map((step, i) => {
        const state =
          status === "DISBURSED" || i < currentIndex
            ? "done"
            : i === currentIndex
              ? "current"
              : "todo";
        const failed = i === currentIndex && (status === "DECLINED" || status === "BOOKING_FAILED");
        const stopped = i === currentIndex && stoppedLabel !== null;
        return (
          <li
            key={step}
            aria-current={state === "current" ? "step" : undefined}
            className={cn(
              "flex-1 rounded-btn px-3 py-2 text-center text-xs font-semibold",
              state === "done" && "bg-ok-100 text-ok-700",
              state === "current" && !failed && !stopped && "bg-gold-100 text-gold-700",
              failed && "bg-bad-100 text-bad-700",
              stopped && "bg-mist-200 text-ink-900",
              state === "todo" && "bg-mist-100 text-mist-500",
            )}
          >
            {stopped
              ? stoppedLabel
              : failed && status === "DECLINED"
                ? "Declined"
                : failed
                  ? "Booking failed"
                  : step}
          </li>
        );
      })}
    </ol>
  );
}
