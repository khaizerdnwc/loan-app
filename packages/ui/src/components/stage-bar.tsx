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
  INFO_REQUESTED: "Review",
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
    // Under 860px the steps wrap onto a second row rather than scroll sideways, so the
    // current step is always on screen and there is no scroll region to reach by keyboard.
    <ol
      aria-label="Case stages"
      data-layout="wrap-narrow"
      className="flex flex-wrap gap-1 min-[860px]:flex-nowrap"
    >
      {steps.map((step, i) => {
        const state =
          status === "DISBURSED" || i < currentIndex
            ? "done"
            : i === currentIndex
              ? "current"
              : "todo";
        const failed = i === currentIndex && (status === "DECLINED" || status === "BOOKING_FAILED");
        const stopped = i === currentIndex && stoppedLabel !== null;
        // The prototype's .stages: done grey, current dark ink, a stop in red, ahead sunken.
        // "Ahead" uses mist-600 rather than the prototype's slate-400 so it stays readable (AA).
        // A withdrawn or expired case is closed, not failed: a white step with a strong ring,
        // so it stands apart from the grey done steps without reading as an error.
        return (
          <li
            key={step}
            aria-current={state === "current" ? "step" : undefined}
            data-state={failed ? "failed" : stopped ? "stopped" : state}
            className={cn(
              "min-w-23 flex-1 rounded-tile px-2.5 py-2 text-xs whitespace-nowrap",
              state === "done" && "bg-mist-200 font-semibold text-ink-700",
              state === "current" && !failed && !stopped && "bg-ink-800 font-semibold text-white",
              failed && "bg-bad-050 font-semibold text-bad-700",
              stopped && "bg-white font-semibold text-ink-900 ring-1 ring-line-strong ring-inset",
              state === "todo" && "bg-mist-100 font-medium text-mist-600",
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
