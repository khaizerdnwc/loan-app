import {
  type DecisionMixReport,
  Money,
  type OriginationFunnelReport,
  type ReportCount,
} from "@loan/core";
import { Injectable } from "@nestjs/common";
import { reportPeriod, share } from "./period";
import { type KeyCount, ReportsRepository } from "./reports.repository";

const OUTCOMES = ["AUTO_APPROVE", "REFER", "AUTO_DECLINE"] as const;

const withShares = (rows: KeyCount[], outOf: number): ReportCount[] =>
  rows.map((r) => ({
    key: r.key,
    ...(r.label ? { label: r.label } : {}),
    count: r.count,
    share: share(r.count, outOf),
  }));

/**
 * The decision-mix and origination-funnel reports (PRD RPT-003, RPT-001), computed from
 * stored records on each request (read-only, no transaction, nothing cached), so a report
 * always matches the data.
 */
@Injectable()
export class ReportsService {
  constructor(private readonly repo: ReportsRepository) {}

  async decisionMix(from?: string, to?: string): Promise<DecisionMixReport> {
    const { period, window } = reportPeriod(from, to);
    const [outcomeRows, reasons, triggers, recs] = await Promise.all([
      this.repo.outcomes(window),
      this.repo.reasonCodes(window),
      this.repo.referralTriggers(window),
      this.repo.recommendations(window),
    ]);
    const byOutcome = new Map(outcomeRows.map((r) => [r.key, r.count]));
    const decisions = outcomeRows.reduce((n, r) => n + r.count, 0);
    const automated = (byOutcome.get("AUTO_APPROVE") ?? 0) + (byOutcome.get("AUTO_DECLINE") ?? 0);
    const referred = byOutcome.get("REFER") ?? 0;
    const overrides = recs.overrideReasons.reduce((n, r) => n + r.count, 0);
    return {
      period,
      decisions,
      outcomes: OUTCOMES.map((key) => ({
        key,
        count: byOutcome.get(key) ?? 0,
        share: share(byOutcome.get(key) ?? 0, decisions),
      })),
      straightThroughRate: share(automated, decisions),
      reasonCodes: withShares(reasons, decisions),
      referralTriggers: withShares(triggers, referred),
      recommendations: recs.total,
      overrides,
      overrideRate: share(overrides, recs.total),
      overrideReasons: withShares(recs.overrideReasons, overrides),
    };
  }

  async funnel(from?: string, to?: string): Promise<OriginationFunnelReport> {
    const { period, window } = reportPeriod(from, to);
    const [f, statuses] = await Promise.all([this.repo.funnel(window), this.repo.statuses(window)]);
    return {
      period,
      stages: [
        { key: "STARTED", count: f.started, conversion: share(f.started, f.started) },
        { key: "SUBMITTED", count: f.submitted, conversion: share(f.submitted, f.started) },
        { key: "APPROVED", count: f.approved, conversion: share(f.approved, f.submitted) },
        {
          key: "DISBURSED",
          count: f.disbursedCount,
          conversion: share(f.disbursedCount, f.approved),
        },
      ],
      disbursedAmount: Money.of(f.disbursedAmount).toString(),
      byStatus: withShares(statuses, f.started),
    };
  }
}
