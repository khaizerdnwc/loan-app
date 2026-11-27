"use client";

import type { AutomationEventView, AutomationView } from "@loan/core";
import { Card, EmptyState, formatDateTime } from "@loan/ui";
import { useEffect, useState } from "react";
import { PageHeader } from "@/components/app-shell";
import { AutomationPanel } from "@/components/automation/automation-panel";
import { LoadState } from "@/components/load-state";
import { useApi } from "@/lib/use-api";

/**
 * Automation controls (PRD §7.5; prototype: Configuration › AI models › Automation controls).
 * Administrators draft and approve mode changes and use the kill switch; compliance reads.
 */
export default function AutomationPage() {
  const automation = useApi<AutomationView[]>("/automation");
  const [views, setViews] = useState<AutomationView[] | null>(null);
  // Bumped after every change so each product's history re-reads.
  const [revision, setRevision] = useState(0);

  useEffect(() => {
    if (automation.data) setViews(automation.data);
  }, [automation.data]);

  return (
    <>
      <PageHeader
        title="Automation controls"
        description="Per product: whether the decision engine's outcome moves a case (live), is only recorded while a person decides (shadow), or is not used (off). The kill switch sends every new application to manual review."
      />
      <LoadState
        loading={automation.loading && !views}
        error={automation.error}
        onRetry={automation.reload}
      />
      {views && views.length === 0 && (
        <Card>
          <EmptyState
            title="No product has automation controls yet"
            hint="A product with none is decided by a person."
          />
        </Card>
      )}
      {views && views.length > 0 && (
        <div className="grid gap-4 min-[1100px]:grid-cols-[3fr_2fr]">
          <AutomationPanel
            views={views}
            onChanged={(next) => {
              setViews(next);
              setRevision((r) => r + 1);
            }}
          />
          <div className="flex flex-col gap-4">
            {views.map((v) => (
              <ProductHistory key={v.productCode} view={v} revision={revision} />
            ))}
          </div>
        </div>
      )}
    </>
  );
}

/** One product's automation history, newest first. */
function ProductHistory({ view, revision }: { view: AutomationView; revision: number }) {
  const history = useApi<AutomationEventView[]>(`/automation/${view.productCode}/history`);
  const { reload } = history;
  useEffect(() => {
    if (revision > 0) void reload();
  }, [revision, reload]);

  return (
    <Card title={`${view.productName} history`}>
      <LoadState
        loading={history.loading && !history.data}
        error={history.error}
        onRetry={history.reload}
      />
      {history.data && history.data.length === 0 && (
        <EmptyState
          title="No changes yet"
          hint="Drafts, approvals and the kill switch appear here."
        />
      )}
      {history.data && history.data.length > 0 && (
        <ol
          aria-label={`${view.productName} automation history`}
          className="flex flex-col divide-y divide-line"
        >
          {history.data.map((e) => (
            <li key={e.id} className="py-2.5 text-sm">
              <p className="text-ink-900">{e.summary}</p>
              <p className="text-xs text-mist-500">
                {e.actorName} · {formatDateTime(e.createdAt)}
              </p>
            </li>
          ))}
        </ol>
      )}
    </Card>
  );
}
