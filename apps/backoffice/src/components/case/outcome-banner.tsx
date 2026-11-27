import type { CaseDetail } from "@loan/core";

const OUTCOME_WORDS = {
  AUTO_APPROVE: "Auto-approved",
  REFER: "Referred to human review",
  AUTO_DECLINE: "Auto-declined",
} as const;

/**
 * The automated outcome under the stage bar. A withdrawn or expired case no longer shows the
 * outcome's colour (a green "Auto-approved" would contradict the closed status): it says
 * neutrally what happened after the decision. A decided case can only expire as an offer
 * (drafts have no decision).
 */
export function OutcomeBanner({ detail: c }: { detail: CaseDetail }) {
  if (!c.decision) return null;
  const { outcome, score, grade, referralTriggers, reasonCodes } = c.decision;
  if (c.status === "WITHDRAWN" || c.status === "EXPIRED") {
    return (
      <div className="rounded-card bg-mist-100 px-5 py-3 text-sm text-ink-900">
        <strong>
          {c.status === "WITHDRAWN"
            ? `${OUTCOME_WORDS[outcome]}, then withdrawn.`
            : `${OUTCOME_WORDS[outcome]}; the offer expired unsigned.`}
        </strong>{" "}
        The application is closed.
      </div>
    );
  }
  if (outcome === "AUTO_APPROVE") {
    return (
      <div className="rounded-card bg-ok-050 px-5 py-3 text-sm text-ok-700">
        <strong>Auto-approved.</strong> Score {score} ({grade}) in the approve band; every policy
        rule passed.
      </div>
    );
  }
  if (outcome === "REFER") {
    return (
      <div className="rounded-card bg-gold-050 px-5 py-3 text-sm text-gold-700">
        <strong>Referred to human review.</strong> {referralTriggers.join(" · ")}
      </div>
    );
  }
  return (
    <div className="rounded-card bg-bad-050 px-5 py-3 text-sm text-bad-700">
      <strong>Auto-declined.</strong> {reasonCodes.map((r) => r.staff).join(" · ")}
    </div>
  );
}
