"use client";

import { type CaseSummary, productLabel } from "@loan/core";
import {
  Avatar,
  type Column,
  formatDateTime,
  formatPeso,
  GradeTile,
  OutcomePill,
  Pill,
  ROW_LINK,
  StagePill,
  Table,
} from "@loan/ui";
import Link from "next/link";

const COLUMNS: Column<CaseSummary>[] = [
  {
    key: "applicant",
    header: "Applicant",
    render: (c) => (
      <div className="flex items-center gap-2.5">
        <Avatar name={c.applicantName} />
        <div>
          {/* The row's one link: Tab reaches it, Enter opens it, and a click anywhere on the
              row follows it (Table clickableRows). */}
          <Link
            {...ROW_LINK}
            href={`/cases/${c.id}`}
            className="font-bold text-ink-900 underline-offset-2 hover:underline"
          >
            {c.applicantName}
          </Link>
          <p className="font-mono text-xs text-mist-500">{c.reference}</p>
        </div>
      </div>
    ),
  },
  {
    key: "product",
    header: "Product",
    render: (c) => <span>{productLabel(c.productCode)}</span>,
  },
  {
    key: "amount",
    header: "Amount",
    numeric: true,
    render: (c) => (
      <div>
        <span className="font-bold text-ink-900">{formatPeso(c.requestedAmount)}</span>
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
    render: (c) => <span className="text-xs whitespace-nowrap">{formatDateTime(c.updatedAt)}</span>,
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
      clickableRows
    />
  );
}
