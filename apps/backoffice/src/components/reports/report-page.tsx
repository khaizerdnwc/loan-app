"use client";

import { Button, Callout, Icon, SegmentedFilter } from "@loan/ui";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { type ReactNode, Suspense, useState } from "react";
import { PageHeader } from "@/components/app-shell";
import { LoadState } from "@/components/load-state";
import { apiFile, errorMessage } from "@/lib/api";
import { PERIODS, type PeriodDays, periodQuery } from "@/lib/reports";
import { useApi } from "@/lib/use-api";

/**
 * A report screen: a period filter, then the report for that period. Reports are computed
 * on request from stored records (no applicant data), so switching the period refetches.
 * The period lives in the URL (`?days=`; none means 30), so Back and a shared link keep it.
 * With `csv`, a Download CSV button (named with its period) fetches the same period's figures
 * as a file (RPT-006) and saves it; the API records each download in the audit log. A refused
 * or failed download says why under the filter row, in the API's words.
 */
export function ReportPage<T>(props: {
  title: string;
  description: string;
  path: string;
  /** The report's CSV download path, e.g. /reports/funnel.csv. */
  csv?: string;
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
  csv,
  render,
}: {
  title: string;
  description: string;
  path: string;
  csv?: string;
  render: (report: T) => ReactNode;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const asked = useSearchParams().get("days");
  const days: PeriodDays = PERIODS.find((p) => p.value === asked)?.value ?? "30";
  const setDays = (next: PeriodDays) =>
    router.replace(next === "30" ? pathname : `${pathname}?days=${next}`, { scroll: false });
  const query = periodQuery(Number(days));
  const report = useApi<T>(`${path}${query}`);
  const periodLabel = PERIODS.find((p) => p.value === days)?.label ?? `${days} days`;
  const [downloading, setDownloading] = useState(false);
  const [downloadError, setDownloadError] = useState<string | null>(null);

  async function download(csvPath: string) {
    setDownloading(true);
    setDownloadError(null);
    try {
      const { blob, fileName } = await apiFile(`${csvPath}${query}`);
      const href = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = href;
      link.download = fileName;
      document.body.append(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(href);
    } catch (err) {
      setDownloadError(errorMessage(err));
    } finally {
      setDownloading(false);
    }
  }

  return (
    <>
      <PageHeader title={title} description={description} />
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <SegmentedFilter
          label="Period"
          value={days}
          options={PERIODS.map((p) => ({ value: p.value, label: p.label }))}
          onChange={setDays}
        />
        {csv && (
          <Button
            size="sm"
            variant="secondary"
            busy={downloading}
            onClick={() => void download(csv)}
          >
            <Icon name="download" className="size-4" />
            Download CSV · {periodLabel}
          </Button>
        )}
      </div>
      {downloadError && (
        <Callout tone="bad" alert className="mb-4">
          The file was not downloaded. {downloadError}
        </Callout>
      )}
      <LoadState loading={report.loading} error={report.error} onRetry={report.reload} />
      {report.data && !report.loading && render(report.data)}
    </>
  );
}
