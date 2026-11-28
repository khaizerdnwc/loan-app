"use client";

import {
  APPROVAL_EXCEPTION_LABEL,
  type ApprovalLevelView,
  GRADES,
  type Grade,
  productLabel,
} from "@loan/core";
import { type Column, formatPeso, Table } from "@loan/ui";

/** Grades as a range when they run on in grade order ("A–C"), else listed ("A, C"). */
export function gradeRange(grades: Grade[]): string {
  if (grades.length === 0) return "None";
  const sorted = [...grades].sort((a, b) => GRADES.indexOf(a) - GRADES.indexOf(b));
  const first = GRADES.indexOf(sorted[0] as Grade);
  const consecutive = sorted.every((g, i) => GRADES.indexOf(g) === first + i);
  if (sorted.length > 1 && consecutive) return `${sorted[0]}–${sorted[sorted.length - 1]}`;
  return sorted.join(", ");
}

const COLUMNS: Column<ApprovalLevelView>[] = [
  {
    key: "level",
    header: "Level",
    render: (l) => (
      <div>
        <span className="font-mono text-ink-900">{l.code}</span>
        <p className="text-xs text-mist-500">{l.name}</p>
      </div>
    ),
  },
  {
    key: "who",
    header: "Who",
    render: (l) =>
      l.approvers.length ? (
        <span>{l.approvers.map((a) => a.fullName).join(", ")}</span>
      ) : (
        <span className="text-mist-500">Nobody holds this level</span>
      ),
  },
  { key: "product", header: "Product", render: (l) => <span>{productLabel(l.productCode)}</span> },
  {
    key: "amount",
    header: "Up to",
    numeric: true,
    render: (l) => <span>{formatPeso(l.maxAmount)}</span>,
  },
  { key: "grades", header: "Grades", render: (l) => <span>{gradeRange(l.grades)}</span> },
  {
    key: "exceptions",
    header: "Exceptions it may approve",
    render: (l) =>
      l.exceptions.length ? (
        <span>{l.exceptions.map((e) => APPROVAL_EXCEPTION_LABEL[e]).join(" · ")}</span>
      ) : (
        <span className="text-mist-500">None</span>
      ),
  },
];

/**
 * The approval matrix (PRD WF-004; the prototype's Configuration › Approval matrix): each
 * delegated level, who holds it, and what it may approve by product, amount, grade and
 * exception type. Read-only: the API decides every approval from these levels.
 */
export function ApprovalMatrixTable({ levels }: { levels: ApprovalLevelView[] }) {
  return (
    <Table
      caption="Approval matrix"
      columns={COLUMNS}
      rows={levels}
      rowKey={(l) => l.code}
      empty="The approval matrix has no levels."
    />
  );
}
