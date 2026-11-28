import { type CaseStatus, SlaState, type SlaView, type TurnaroundStage } from "@loan/core";
import { share } from "../reports/period";
import { addBusinessMinutes, businessMinutesBetween } from "./business-time";
import type { StatusEvent } from "./sla.repository";
import { AT_RISK_MINUTES, SLA_POLICY } from "./sla-policy";

/** A case's clock in its current stage at `now`, or null when the stage has no SLA. */
export function slaFor(
  caseId: string,
  status: CaseStatus,
  enteredAt: Date | null,
  now: Date,
  holidays: ReadonlySet<string>,
): SlaView | null {
  const policy = SLA_POLICY[status];
  if (!policy || !enteredAt) return null;
  const elapsed = businessMinutesBetween(enteredAt, now, holidays);
  const remaining = policy.minutes - elapsed;
  return {
    caseId,
    status,
    enteredAt: enteredAt.toISOString(),
    targetMinutes: policy.minutes,
    elapsedMinutes: elapsed,
    remainingMinutes: remaining,
    dueAt: addBusinessMinutes(enteredAt, policy.minutes, holidays).toISOString(),
    state:
      remaining < 0
        ? SlaState.Breached
        : remaining <= AT_RISK_MINUTES
          ? SlaState.AtRisk
          : SlaState.OnTrack,
    owner: policy.owner,
  };
}

/** One stay in a stage: entered by a status event, ended by the case's next one. */
export interface StageVisit {
  caseId: string;
  status: CaseStatus;
  enteredAt: Date;
  leftAt: Date;
}

/**
 * Rebuild completed stage visits from status events (sorted by case, then time). A re-decision
 * into the same stage (REVIEW → REVIEW) ends one visit and starts another, as the clock does.
 */
export function stageVisits(events: StatusEvent[]): StageVisit[] {
  const visits: StageVisit[] = [];
  for (let i = 0; i + 1 < events.length; i += 1) {
    const e = events[i] as StatusEvent;
    const next = events[i + 1] as StatusEvent;
    if (next.caseId !== e.caseId) continue;
    visits.push({ caseId: e.caseId, status: e.toStatus, enteredAt: e.at, leftAt: next.at });
  }
  return visits;
}

/** Nearest-rank percentile of sorted minutes. */
function percentile(sorted: number[], p: number): number | null {
  if (sorted.length === 0) return null;
  const rank = Math.max(1, Math.ceil((p / 100) * sorted.length));
  return sorted[rank - 1] ?? null;
}

/** Turnaround per stage for the visits that ended in [from, until), in business minutes. */
export function turnaround(
  visits: StageVisit[],
  from: Date,
  until: Date,
  holidays: ReadonlySet<string>,
): TurnaroundStage[] {
  const byStatus = new Map<CaseStatus, number[]>();
  for (const v of visits) {
    if (v.leftAt < from || v.leftAt >= until) continue;
    const minutes = businessMinutesBetween(v.enteredAt, v.leftAt, holidays);
    byStatus.set(v.status, [...(byStatus.get(v.status) ?? []), minutes]);
  }
  const statuses = Object.keys(SLA_POLICY) as CaseStatus[];
  return statuses.map((status) => {
    const minutes = (byStatus.get(status) ?? []).sort((a, b) => a - b);
    const target = SLA_POLICY[status]?.minutes ?? null;
    const within = target === null ? 0 : minutes.filter((m) => m <= target).length;
    return {
      status,
      visits: minutes.length,
      medianMinutes: percentile(minutes, 50),
      p90Minutes: percentile(minutes, 90),
      targetMinutes: target,
      withinTarget: within,
      withinTargetShare: target !== null && minutes.length ? share(within, minutes.length) : null,
    };
  });
}
