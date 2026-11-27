"use client";

import type { DecisionMixReport } from "@loan/core";
import { ReportPage } from "@/components/reports/report-page";
import { DecisionMixView } from "@/components/reports/report-views";

/** Decisioning dashboard (PRD RPT-003): decision mix, straight-through rate, overrides. */
export default function DecisionsPage() {
  return (
    <ReportPage<DecisionMixReport>
      title="Decisioning"
      description="Straight-through processing, decision mix, reason codes and overrides for the decisions made in the period."
      path="/reports/decision-mix"
      render={(r) => <DecisionMixView report={r} />}
    />
  );
}
