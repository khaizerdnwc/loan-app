import { Injectable } from "@nestjs/common";
import { InjectDataSource } from "@nestjs/typeorm";
import { DataSource } from "typeorm";

export interface VersionUsage {
  version: string;
  decisions: number;
  first: Date | null;
  last: Date | null;
}

export interface RecommendationRow {
  engineOutcome: string;
  automationMode: string;
  killSwitch: boolean;
  recommendation: string;
  overrideReason: string | null;
  isOverride: boolean;
}

export interface GradeCount {
  grade: string;
  n: number;
  scoreSum: number;
}

/** Decisions per version: one fixed statement per column (no SQL built from input). */
const USAGE_SQL = {
  scorecard_version: `SELECT scorecard_version AS version, count(*) AS n, min(created_at) AS first,
      max(created_at) AS last FROM decision_record GROUP BY scorecard_version ORDER BY scorecard_version`,
  rule_set_version: `SELECT rule_set_version AS version, count(*) AS n, min(created_at) AS first,
      max(created_at) AS last FROM decision_record GROUP BY rule_set_version ORDER BY rule_set_version`,
} as const;

/** Read-only SQL over decision records and the case history, for model governance. */
@Injectable()
export class GovernanceRepository {
  constructor(@InjectDataSource() private readonly ds: DataSource) {}

  async usageBy(column: keyof typeof USAGE_SQL): Promise<VersionUsage[]> {
    const rows: { version: string; n: string; first: Date | null; last: Date | null }[] =
      await this.ds.query(USAGE_SQL[column]);
    return rows.map((r) => ({
      version: r.version,
      decisions: Number(r.n),
      first: r.first,
      last: r.last,
    }));
  }

  /**
   * Every recommendation sent in the window, with the engine's outcome and mode of the decision
   * it acted on: the one named in the event, or the case's current decision for events written
   * before recommendations recorded it.
   */
  async recommendations(since: Date): Promise<RecommendationRow[]> {
    const rows: {
      engine_outcome: string;
      automation_mode: string;
      kill_switch: boolean;
      recommendation: string;
      override_reason: string | null;
      action: string;
    }[] = await this.ds.query(
      `SELECT COALESCE(d.engine_outcome, d.outcome) AS engine_outcome, d.automation_mode,
              d.kill_switch, e.details->>'type' AS recommendation,
              e.details->>'overrideReason' AS override_reason, e.action
       FROM activity_event e
       JOIN loan_case c ON c.id = e.case_id
       JOIN decision_record d ON d.id = COALESCE((e.details->>'decisionId')::uuid, c.decision_id)
       WHERE e.action IN ('RECOMMENDED', 'RECOMMENDED_WITH_OVERRIDE') AND e.created_at >= $1
       ORDER BY e.created_at`,
      [since],
    );
    return rows.map((r) => ({
      engineOutcome: r.engine_outcome,
      automationMode: r.automation_mode,
      killSwitch: r.kill_switch,
      recommendation: r.recommendation,
      overrideReason: r.override_reason,
      isOverride: r.action === "RECOMMENDED_WITH_OVERRIDE",
    }));
  }

  /** Scored decisions per grade in [from, to). */
  async gradeCounts(from: Date, to: Date): Promise<GradeCount[]> {
    const rows: { grade: string; n: string; score_sum: string }[] = await this.ds.query(
      `SELECT grade, count(*) AS n, sum(score) AS score_sum FROM decision_record
       WHERE score IS NOT NULL AND created_at >= $1 AND created_at < $2
       GROUP BY grade ORDER BY grade`,
      [from, to],
    );
    return rows.map((r) => ({ grade: r.grade, n: Number(r.n), scoreSum: Number(r.score_sum) }));
  }
}
