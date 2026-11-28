"use client";

import { SegmentedFilter } from "@loan/ui";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { type ReactNode, Suspense } from "react";
import { PageHeader } from "@/components/app-shell";
import { LoadState } from "@/components/load-state";
import { PERIODS, type PeriodDays, periodQuery } from "@/lib/reports";
import { useApi } from "@/lib/use-api";

/**
 * A report screen: a period filter, then the report for that period. Reports are computed
 * on request from stored records (no applicant data), so switching the period refetches.
 * The period lives in the URL (`?days=`; none means 30), so Back and a shared link keep it.
 */
export function ReportPage<T>(props: {
  title: string;
  description: string;
  path: string;
  render: (report: T) => ReactNode;
}) {
  // useSearchParams needs a Suspense boundary in a statically rendered page.
  return (
    <Suspense fallback={null}>
      <Report {...props} />
    </Suspense>
  );
}

function Report<T>({
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
  const router = useRouter();
  const pathname = usePathname();
  const asked = useSearchParams().get("days");
  const days: PeriodDays = PERIODS.find((p) => p.value === asked)?.value ?? "30";
  const setDays = (next: PeriodDays) =>
    router.replace(next === "30" ? pathname : `${pathname}?days=${next}`, { scroll: false });
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
