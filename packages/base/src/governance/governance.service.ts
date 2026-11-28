import {
  type DecisionOutcome,
  type DriftStatus,
  type DriftView,
  GRADES,
  type Grade,
  type ModelRegistryView,
  type OverrideMonitorView,
  type OverrideReason,
  type Recommendation,
} from "@loan/core";
import { Injectable } from "@nestjs/common";
import {
  CURRENT_RULE_SET,
  CURRENT_SCORECARD,
  PROHIBITED_FEATURES,
  prohibitedFeaturesIn,
  RULE_SETS,
  SCORECARDS,
} from "../decisioning/engine";
import {
  GovernanceRepository,
  type GradeCount,
  type RecommendationRow,
  type VersionUsage,
} from "./governance.repository";

const DAY = 86_400_000;

/** Each drift window needs this many scored decisions before a status is given. */
export const DRIFT_MINIMUM = 30;

/**
 * Model governance (PRD AIS-008 registry, AIS-009 drift, AIS-011 overrides, AIS-012 prohibited
 * features; CMP-008). Read-only: it reports on stored decisions and the case history.
 */
@Injectable()
export class GovernanceService {
  constructor(private readonly repo: GovernanceRepository) {}

  async registry(): Promise<ModelRegistryView> {
    const [scorecardUse, ruleSetUse] = await Promise.all([
      this.repo.usageBy("scorecard_version"),
      this.repo.usageBy("rule_set_version"),
    ]);
    return {
      scorecards: Object.values(SCORECARDS).map((sc) => ({
        version: sc.version,
        current: sc.version === CURRENT_SCORECARD,
        features: [...sc.features],
        prohibitedFeatures: prohibitedFeaturesIn(sc),
        hasPd: Boolean(sc.pdByGrade),
        ...usageOf(scorecardUse, sc.version),
      })),
      ruleSets: Object.values(RULE_SETS).map((rs) => ({
        version: rs.version,
        current: rs.version === CURRENT_RULE_SET,
        ...usageOf(ruleSetUse, rs.version),
      })),
      prohibitedFeatures: [...PROHIBITED_FEATURES],
    };
  }

  async overrides(since: Date): Promise<OverrideMonitorView> {
    const rows = await this.repo.recommendations(since);
    return { since: since.toISOString(), ...summariseRecommendations(rows) };
  }

  async drift(recentDays: number, baselineDays: number, now = new Date()): Promise<DriftView> {
    const recentFrom = new Date(now.getTime() - recentDays * DAY);
    const baselineFrom = new Date(recentFrom.getTime() - baselineDays * DAY);
    const [baseline, recent] = await Promise.all([
      this.repo.gradeCounts(baselineFrom, recentFrom),
      this.repo.gradeCounts(recentFrom, now),
    ]);
    return {
      baseline: summariseWindow(baselineFrom, recentFrom, baseline),
      recent: summariseWindow(recentFrom, now, recent),
      ...compareGrades(baseline, recent),
      minimumDecisions: DRIFT_MINIMUM,
    };
  }
}

function usageOf(rows: VersionUsage[], version: string) {
  const u = rows.find((r) => r.version === version);
  return {
    decisions: u?.decisions ?? 0,
    firstUsedAt: u?.first ? new Date(u.first).toISOString() : null,
    lastUsedAt: u?.last ? new Date(u.last).toISOString() : null,
  };
}

function summariseWindow(from: Date, to: Date, counts: GradeCount[]) {
  const n = counts.reduce((s, c) => s + c.n, 0);
  const sum = counts.reduce((s, c) => s + c.scoreSum, 0);
  return {
    from: from.toISOString(),
    to: to.toISOString(),
    decisions: n,
    meanScore: n === 0 ? null : Math.round((sum / n) * 10) / 10,
  };
}

/** Counts, reasons, the outcome matrix and not-live agreement from recommendation rows. */
export function summariseRecommendations(
  rows: RecommendationRow[],
): Omit<OverrideMonitorView, "since"> {
  const reasons = new Map<string, number>();
  const cells = new Map<string, number>();
  let compared = 0;
  let agreed = 0;
  for (const r of rows) {
    if (r.isOverride && r.overrideReason) {
      reasons.set(r.overrideReason, (reasons.get(r.overrideReason) ?? 0) + 1);
    }
    const key = `${r.engineOutcome}|${r.recommendation}`;
    cells.set(key, (cells.get(key) ?? 0) + 1);
    // Off, shadow or kill switch: the engine's outcome was only recorded, so compare it.
    const notLive = r.automationMode !== "LIVE" || r.killSwitch;
    if (notLive && r.engineOutcome !== "REFER") {
      compared += 1;
      const engineApproves = r.engineOutcome === "AUTO_APPROVE";
      const personApproves = r.recommendation !== "DECLINE";
      if (engineApproves === personApproves) agreed += 1;
    }
  }
  return {
    recommendations: rows.length,
    overrides: rows.filter((r) => r.isOverride).length,
    byReason: [...reasons.entries()]
      .map(([code, count]) => ({ code: code as OverrideReason, count }))
      .sort((a, b) => b.count - a.count || a.code.localeCompare(b.code)),
    matrix: [...cells.entries()].map(([key, count]) => {
      const [engineOutcome, recommendation] = key.split("|");
      return {
        engineOutcome: engineOutcome as DecisionOutcome,
        recommendation: recommendation as Recommendation,
        count,
      };
    }),
    notLive: { compared, agreed },
  };
}

/**
 * Grade shares in each window and their population stability index: Σ (r − b) · ln(r / b) over
 * the grades, an empty grade counted as 0.01% so the logarithm is defined. The usual thresholds:
 * under 0.10 stable, under 0.25 moderate, otherwise significant. Fewer than DRIFT_MINIMUM
 * scored decisions in either window gives no status.
 */
export function compareGrades(
  baseline: GradeCount[],
  recent: GradeCount[],
): Pick<DriftView, "grades" | "psi" | "status"> {
  const total = (c: GradeCount[]) => c.reduce((s, x) => s + x.n, 0);
  const bTotal = total(baseline);
  const rTotal = total(recent);
  const share = (c: GradeCount[], t: number, g: Grade) =>
    t === 0 ? 0 : (c.find((x) => x.grade === g)?.n ?? 0) / t;
  const FLOOR = 0.0001;
  let psi = 0;
  const grades = GRADES.map((grade) => {
    const b = share(baseline, bTotal, grade);
    const r = share(recent, rTotal, grade);
    const bb = Math.max(b, FLOOR);
    const rr = Math.max(r, FLOOR);
    psi += (rr - bb) * Math.log(rr / bb);
    return {
      grade,
      baselinePct: Math.round(b * 1000) / 10,
      recentPct: Math.round(r * 1000) / 10,
    };
  });
  const enough = bTotal >= DRIFT_MINIMUM && rTotal >= DRIFT_MINIMUM;
  const status: DriftStatus = !enough
    ? "INSUFFICIENT_DATA"
    : psi < 0.1
      ? "STABLE"
      : psi < 0.25
        ? "MODERATE"
        : "SIGNIFICANT";
  // Not computed on too little data: a figure there would read as a measurement.
  return { grades, psi: enough ? psi.toFixed(4) : null, status };
}
