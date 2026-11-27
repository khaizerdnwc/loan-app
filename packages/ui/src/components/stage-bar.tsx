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

const CURRENT: Record<CaseStatus, Step> = {
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

/** The stages a case moves through; done steps, the current one, and what is still ahead. */
export function StageBar({ status, wasReferred }: { status: CaseStatus; wasReferred: boolean }) {
  const steps = STEPS.filter((s) => wasReferred || (s !== "Review" && s !== "Approval"));
  const currentIndex = steps.indexOf(CURRENT[status]);
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
        return (
          <li
            key={step}
            aria-current={state === "current" ? "step" : undefined}
            className={cn(
              "flex-1 rounded-btn px-3 py-2 text-center text-xs font-semibold",
              state === "done" && "bg-ok-100 text-ok-700",
              state === "current" && !failed && "bg-gold-100 text-gold-700",
              failed && "bg-bad-100 text-bad-700",
              state === "todo" && "bg-mist-100 text-mist-500",
            )}
          >
            {failed && status === "DECLINED" ? "Declined" : failed ? "Booking failed" : step}
          </li>
        );
      })}
    </ol>
  );
}
