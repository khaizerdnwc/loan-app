import type { CaseDetail } from "@loan/core";
import { Callout } from "@loan/ui";

const OUTCOME_WORDS = {
  AUTO_APPROVE: "Auto-approved",
  REFER: "Referred to human review",
  AUTO_DECLINE: "Auto-declined",
} as const;

/**
 * The automated outcome under the stage bar. A withdrawn or expired case no longer shows the
 * outcome's colour (a green "Auto-approved" would contradict the closed status): it says
 * neutrally what happened after the decision. A decided case can only expire as an offer
 * (drafts have no decision). Drawn with the shared Callout (the prototype's .trig box).
 */
export function OutcomeBanner({ detail: c }: { detail: CaseDetail }) {
  if (!c.decision) return null;
  const { outcome, score, grade, referralTriggers, reasonCodes } = c.decision;
  if (c.status === "WITHDRAWN" || c.status === "EXPIRED") {
    return (
      <Callout
        tone="neutral"
        lead={
          c.status === "WITHDRAWN"
            ? `${OUTCOME_WORDS[outcome]}, then withdrawn.`
            : `${OUTCOME_WORDS[outcome]}; the offer expired unsigned.`
        }
      >
        The application is closed.
      </Callout>
    );
  }
  if (outcome === "AUTO_APPROVE") {
    return (
      <Callout tone="ok" lead="Auto-approved.">
        Score {score} ({grade}) in the approve band; every policy rule passed.
      </Callout>
    );
  }
  if (outcome === "REFER") {
    return (
      <Callout tone="warn" lead="Referred to human review.">
        {referralTriggers.join(" · ")}
      </Callout>
    );
  }
  return (
    <Callout tone="bad" lead="Auto-declined.">
      {reasonCodes.map((r) => r.staff).join(" · ")}
    </Callout>
  );
}
