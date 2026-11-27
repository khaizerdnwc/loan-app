"use client";

import { SegmentedFilter } from "@loan/ui";
import { type ReactNode, useState } from "react";
import { PageHeader } from "@/components/app-shell";
import { LoadState } from "@/components/load-state";
import { PERIODS, type PeriodDays, periodQuery } from "@/lib/reports";
import { useApi } from "@/lib/use-api";

/**
 * A report screen: a period filter, then the report for that period. Reports are computed
 * on request from stored records (no applicant data), so switching the period refetches.
 */
export function ReportPage<T>({
  title,
  description,
  path,
  render,
}: {
  title: string;
  description: string;
  path: string;
  render: (report: T) => ReactNode;
}) {
  const [days, setDays] = useState<PeriodDays>("30");
  const report = useApi<T>(`${path}${periodQuery(Number(days))}`);
  return (
    <>
      <PageHeader title={title} description={description} />
      <div className="mb-4">
        <SegmentedFilter
          label="Period"
          value={days}
          options={PERIODS.map((p) => ({ value: p.value, label: p.label }))}
          onChange={setDays}
        />
      </div>
      <LoadState loading={report.loading} error={report.error} onRetry={report.reload} />
      {report.data && !report.loading && render(report.data)}
    </>
  );
}
