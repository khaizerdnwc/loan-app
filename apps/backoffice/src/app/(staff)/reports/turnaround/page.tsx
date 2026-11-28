"use client";

import type { TurnaroundReport } from "@loan/core";
import { ReportPage } from "@/components/reports/report-page";
import { TurnaroundView } from "@/components/reports/report-views";

/** Turnaround and SLA (PRD RPT-002), as the prototype's Reports screen. */
export default function TurnaroundPage() {
  return (
    <ReportPage<TurnaroundReport>
      title="Turnaround and SLA"
      description="Business time spent in each stage, against its SLA, and the open cases past or near their SLA now."
      path="/reports/turnaround"
      render={(r) => <TurnaroundView report={r} />}
    />
  );
}
