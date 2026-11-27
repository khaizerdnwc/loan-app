import {
  type AmlEscalationView,
  ESCALATION_OUTCOME_LABEL,
  ESCALATION_STATUS_LABEL,
} from "@loan/core";
import { Pill, type Tone } from "@loan/ui";

const STATUS_TONE: Record<AmlEscalationView["status"], Tone> = {
  OPEN: "bad",
  ACKNOWLEDGED: "warn",
  CLOSED: "ok",
};

/** One wording and colour for an escalation's state: open, acknowledged, or how it closed. */
export function EscalationStatusPill({ e }: { e: AmlEscalationView }) {
  if (e.status === "CLOSED" && e.outcome) {
    return (
      <Pill tone={e.outcome === "CONFIRMED_MATCH" ? "bad" : "ok"}>
        {ESCALATION_OUTCOME_LABEL[e.outcome]}
      </Pill>
    );
  }
  return <Pill tone={STATUS_TONE[e.status]}>{ESCALATION_STATUS_LABEL[e.status]}</Pill>;
}
