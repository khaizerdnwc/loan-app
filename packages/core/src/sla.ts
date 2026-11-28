/**
 * The HTTP contract for stage SLAs (PRD WF-003) and the turnaround report (PRD RPT-002).
 * Times are in Philippine business minutes (Monday to Friday, 09:00–17:00 Manila, less the
 * holiday calendar).
 */
import type { CaseStatus } from "./domain";

export const SlaState = {
  OnTrack: "ON_TRACK",
  /** Two business hours or less left. */
  AtRisk: "AT_RISK",
  Breached: "BREACHED",
} as const;
export type SlaState = (typeof SlaState)[keyof typeof SlaState];

export const SLA_STATE_LABEL: Record<SlaState, string> = {
  ON_TRACK: "On track",
  AT_RISK: "At risk",
  BREACHED: "Past SLA",
};

/** A case's clock in its current stage (only stages with a target have one). */
export interface SlaView {
  caseId: string;
  status: CaseStatus;
  /** When the case entered the stage (from its activity history). */
  enteredAt: string;
  targetMinutes: number;
  elapsedMinutes: number;
  /** Negative once breached. */
  remainingMinutes: number;
  dueAt: string;
  state: SlaState;
  /** Who acts next in this stage, in words. */
  owner: string;
}

export interface TurnaroundStage {
  status: CaseStatus;
  /** Stage visits that ended in the period. */
  visits: number;
  medianMinutes: number | null;
  p90Minutes: number | null;
  /** The stage's SLA in business minutes, or null when it has none. */
  targetMinutes: number | null;
  withinTarget: number;
  /** Share of visits within the target ("0.9000"); null without a target or visits. */
  withinTargetShare: string | null;
}

/** RPT-002: time spent per stage, in business minutes, for stage visits ending in the period. */
export interface TurnaroundReport {
  period: { from: string; to: string };
  stages: TurnaroundStage[];
  /** Cases open now in a stage with an SLA, by state. */
  openNow: { onTrack: number; atRisk: number; breached: number };
  businessDay: { start: string; end: string };
  /** Holidays in the period that the business clock skipped. */
  holidays: { date: string; name: string }[];
  /** The last date the holiday calendar covers (null when it is empty): past it, no holiday is skipped. */
  holidayCalendarEnds: string | null;
}

/** One case's clock, and how far the holiday calendar reaches. */
export interface CaseSlaView {
  /** Null for a stage without an SLA. */
  sla: SlaView | null;
  holidayCalendarEnds: string | null;
}
