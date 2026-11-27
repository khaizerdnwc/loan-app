"use client";

import type { CaseSummary } from "@loan/core";
import {
  type Column,
  formatDateTime,
  formatPeso,
  GradeTile,
  OutcomePill,
  Pill,
  StagePill,
  Table,
} from "@loan/ui";
import Link from "next/link";

const COLUMNS: Column<CaseSummary>[] = [
  {
    key: "applicant",
    header: "Applicant",
    render: (c) => (
      <div>
        <Link
          href={`/cases/${c.id}`}
          className="font-semibold text-ink-900 underline-offset-2 hover:underline"
        >
          {c.applicantName}
        </Link>
        <p className="font-mono text-xs text-mist-500">{c.reference}</p>
      </div>
    ),
  },
  {
    key: "amount",
    header: "Amount",
    numeric: true,
    render: (c) => (
      <div>
        {formatPeso(c.requestedAmount)}
        <p className="text-xs text-mist-500">{c.requestedTenorMonths} months</p>
      </div>
    ),
  },
  { key: "stage", header: "Stage", render: (c) => <StagePill status={c.status} /> },
  {
    key: "outcome",
    header: "Decision",
    render: (c) => (
      <div className="flex items-center gap-2">
        <OutcomePill outcome={c.outcome} />
        {c.escalated && <Pill tone="bad">Escalated</Pill>}
      </div>
    ),
  },
  { key: "grade", header: "Grade", render: (c) => <GradeTile grade={c.grade} /> },
  {
    key: "updated",
    header: "Updated",
    render: (c) => <span className="text-xs">{formatDateTime(c.updatedAt)}</span>,
  },
];

export function CaseTable({ cases, empty }: { cases: CaseSummary[]; empty: string }) {
  return (
    <Table
      caption="Loan applications"
      columns={COLUMNS}
      rows={cases}
      rowKey={(c) => c.id}
      empty={empty}
    />
  );
}
