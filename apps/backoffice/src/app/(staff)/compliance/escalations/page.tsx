"use client";

import { type AmlEscalationView, SCREENING_STAGE_LABEL } from "@loan/core";
import { type Column, formatDateTime, ROW_LINK, SegmentedFilter, Table } from "@loan/ui";
import Link from "next/link";
import { useState } from "react";
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

/**
 * AML escalations (PRD CMP-005, F6): screening matches escalated from cases, at application
 * or before disbursement. Compliance opens one to acknowledge it and close it with notes.
 */
export default function EscalationsPage() {
  const [view, setView] = useState<"open" | "all">("open");
  const list = useApi<AmlEscalationView[]>(`/compliance/escalations?view=${view}`);
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
            { value: "open", label: "Open" },
            { value: "all", label: "All" },
          ]}
          onChange={setView}
        />
      </div>
      <LoadState loading={list.loading} error={list.error} onRetry={list.reload} />
      {/* Hidden while a new view loads, so Open rows never sit under "All". */}
      {list.data && !list.loading && (
        <Table
          caption="AML escalations"
          columns={COLUMNS}
          rows={list.data}
          rowKey={(e) => e.id}
          empty={view === "open" ? "No open escalations." : "No escalations yet."}
          clickableRows
        />
      )}
    </>
  );
}
