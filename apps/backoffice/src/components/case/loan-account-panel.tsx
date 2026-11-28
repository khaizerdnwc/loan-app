"use client";

import type { LoanAccountView, ScheduleLineView } from "@loan/core";
import {
  Card,
  type Column,
  formatDate,
  formatDateTime,
  formatMonthlyRate,
  formatPeso,
  KeyValues,
  Pill,
  SimulatedLabel,
  Table,
} from "@loan/ui";
import { LoadState } from "@/components/load-state";
import { useApi } from "@/lib/use-api";

const COLUMNS: Column<ScheduleLineView>[] = [
  { key: "n", header: "#", render: (l) => <span className="tabular-nums">{l.number}</span> },
  { key: "due", header: "Due", render: (l) => formatDate(l.dueDate) },
  { key: "principal", header: "Principal", numeric: true, render: (l) => formatPeso(l.principal) },
  { key: "interest", header: "Interest", numeric: true, render: (l) => formatPeso(l.interest) },
  { key: "amount", header: "Instalment", numeric: true, render: (l) => formatPeso(l.amount) },
];

/** The booked loan as core banking holds it: terms, the full schedule and the disbursement. */
export function LoanAccountPanel({ caseId }: { caseId: string }) {
  const account = useApi<LoanAccountView>(`/cases/${caseId}/loan-account`);
  if (!account.data) {
    return (
      <Card title="Loan account">
        <LoadState loading={account.loading} error={account.error} onRetry={account.reload} />
      </Card>
    );
  }
  const a = account.data;
  return (
    <Card
      title={`Loan account ${a.coreAccountNumber}`}
      aside={<SimulatedLabel what="core banking" />}
    >
      <KeyValues
        items={[
          { label: "Principal", value: formatPeso(a.principal) },
          { label: "Interest (add-on)", value: formatPeso(a.interest) },
          { label: "Total repayable", value: formatPeso(a.totalRepayable) },
          {
            label: "Rate · tenor",
            value: `${formatMonthlyRate(a.monthlyRate)} · ${a.tenorMonths} months`,
          },
        ]}
      />
      <p className="mt-4 flex items-center gap-2 text-sm">
        {a.reconciled ? (
          <Pill tone="ok">Reconciled</Pill>
        ) : (
          <Pill tone="bad">Does not reconcile</Pill>
        )}
        Σ instalments = principal + interest, checked to the centavo when the account was stored.
        Opened {formatDateTime(a.openedAt)}.
      </p>

      {a.disbursement ? (
        <div className="mt-4 rounded-btn border border-line px-4 py-3 text-sm">
          <p className="flex flex-wrap items-center gap-2">
            <strong className="text-ink-900">Disbursed {formatPeso(a.disbursement.amount)}</strong>
            to <span className="font-mono text-xs">{a.disbursement.destinationAccount}</span> · ref{" "}
            <span className="font-mono text-xs">{a.disbursement.reference}</span> ·{" "}
            {formatDateTime(a.disbursement.disbursedAt)}
            <SimulatedLabel what="disbursement" />
          </p>
        </div>
      ) : (
        <p className="mt-4 text-sm text-bad-700">No disbursement is recorded for this account.</p>
      )}

      <div className="mt-5">
        <Table
          caption="Repayment schedule"
          columns={COLUMNS}
          rows={a.schedule}
          rowKey={(l) => String(l.number)}
          empty="No schedule lines."
          footer={
            <tr>
              <td className="px-4 py-3" colSpan={2}>
                Total ({a.schedule.length} instalments)
              </td>
              <td className="px-4 py-3 text-right tabular-nums">{formatPeso(a.principal)}</td>
              <td className="px-4 py-3 text-right tabular-nums">{formatPeso(a.interest)}</td>
              <td className="px-4 py-3 text-right tabular-nums">{formatPeso(a.totalRepayable)}</td>
            </tr>
          }
        />
      </div>
    </Card>
  );
}
