"use client";

import type { OriginationFunnelReport } from "@loan/core";
import { ReportPage } from "@/components/reports/report-page";
import { FunnelView } from "@/components/reports/report-views";

/** Origination funnel (PRD RPT-001), as the prototype's Reports screen. */
export default function FunnelPage() {
  return (
    <ReportPage<OriginationFunnelReport>
      title="Origination funnel"
      description="Applications started in the period and how far they got. Drop-off between stages shows where applications stall."
      path="/reports/funnel"
      csv="/reports/funnel.csv"
      render={(r) => <FunnelView report={r} />}
    />
  );
}
