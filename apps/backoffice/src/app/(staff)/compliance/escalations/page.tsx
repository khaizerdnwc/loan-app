"use client";

import { type AmlEscalationView, SCREENING_STAGE_LABEL } from "@loan/core";
import { type Column, formatDateTime, ROW_LINK, SegmentedFilter, Table } from "@loan/ui";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { PageHeader } from "@/components/app-shell";
import { EscalationStatusPill } from "@/components/compliance/escalation-pills";
import { LoadState } from "@/components/load-state";
import { useApi } from "@/lib/use-api";

const COLUMNS: Column<AmlEscalationView>[] = [
  {
    key: "name",
    header: "Name",
    render: (e) => (
      <Link
        {...ROW_LINK}
        href={`/compliance/escalations/${e.id}`}
        className="font-bold text-ink-900 underline-offset-2 hover:underline"
      >
        {e.applicantName}
      </Link>
    ),
  },
  {
    key: "case",
    header: "Case",
    render: (e) => (
      <Link
        href={`/cases/${e.caseId}`}
        className="font-mono text-xs underline-offset-2 hover:underline"
      >
        {e.caseReference}
      </Link>
    ),
  },
  {
    key: "stage",
    header: "Screening",
    render: (e) => <span>{SCREENING_STAGE_LABEL[e.stage]}</span>,
  },
  {
    key: "match",
    header: "Match",
    render: (e) => <span>{e.matchedList ?? "Sanctions or watchlist match"}</span>,
  },
  { key: "status", header: "Status", render: (e) => <EscalationStatusPill e={e} /> },
  {
    key: "opened",
    header: "Opened",
    render: (e) => <span className="text-xs">{formatDateTime(e.openedAt)}</span>,
  },
];

/** Open means not closed yet (open or acknowledged), as the API's `view=open` filters. */
const isOpen = (e: AmlEscalationView) => e.status !== "CLOSED";

/**
 * AML escalations (PRD CMP-005, F6): screening matches escalated from cases, at application
 * or before disbursement. Compliance opens one to acknowledge it and close it with notes.
 * One list (`view=all`) gives both filters their counts; the choice lives in the URL
 * (`?view=all`; none means open), so Back from an escalation restores it.
 */
export default function EscalationsPage() {
  // useSearchParams needs a Suspense boundary in a statically rendered page.
  return (
    <Suspense fallback={null}>
      <Escalations />
    </Suspense>
  );
}

function Escalations() {
  const router = useRouter();
  const view = useSearchParams().get("view") === "all" ? "all" : "open";
  const setView = (next: "open" | "all") =>
    router.replace(
      next === "all" ? "/compliance/escalations?view=all" : "/compliance/escalations",
      { scroll: false },
    );
  const list = useApi<AmlEscalationView[]>("/compliance/escalations?view=all");
  const all = list.data ?? [];
  const rows = view === "open" ? all.filter(isOpen) : all;
  const counted = list.data !== null;
  return (
    <>
      <PageHeader
        title="AML escalations"
        description="Screening matches escalated from cases, at application or before disbursement. Screening is simulated in this release: no real watchlist is queried."
      />
      <div className="mb-4">
        <SegmentedFilter
          label="Which escalations"
          value={view}
          options={[
            {
              value: "open" as const,
              label: "Open",
              count: counted ? all.filter(isOpen).length : undefined,
            },
            { value: "all" as const, label: "All", count: counted ? all.length : undefined },
          ]}
          onChange={setView}
        />
      </div>
      <LoadState loading={list.loading && !list.data} error={list.error} onRetry={list.reload} />
      {list.data && (
        <Table
          caption="AML escalations"
          columns={COLUMNS}
          rows={rows}
          rowKey={(e) => e.id}
          empty={view === "open" ? "No open escalations." : "No escalations yet."}
          clickableRows
        />
      )}
    </>
  );
}
