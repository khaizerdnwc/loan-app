"use client";

import { type BookingExceptionView, RECONCILIATION_KIND_LABEL } from "@loan/core";
import {
  type Column,
  EmptyState,
  formatAmountsInText,
  formatDateTime,
  formatPeso,
  Pill,
  ROW_LINK,
  Table,
} from "@loan/ui";
import Link from "next/link";
import { PageHeader } from "@/components/app-shell";
import { LoadState } from "@/components/load-state";
import { ReconciliationPanel } from "@/components/operations/reconciliation-panel";
import { useSession } from "@/lib/session";
import { useApi } from "@/lib/use-api";

const COLUMNS: Column<BookingExceptionView>[] = [
  {
    key: "applicant",
    header: "Applicant",
    render: (e) => (
      <div>
        <Link
          {...ROW_LINK}
          href={`/cases/${e.caseId}`}
          className="font-bold text-ink-900 underline-offset-2 hover:underline"
        >
          {e.applicantName}
        </Link>
        <p className="font-mono text-xs text-mist-500">{e.caseReference}</p>
      </div>
    ),
  },
  { key: "amount", header: "Amount", numeric: true, render: (e) => formatPeso(e.amount) },
  {
    key: "error",
    header: "Last error",
    render: (e) => (
      <div className="text-xs">
        <p>{e.lastError ? formatAmountsInText(e.lastError) : "No error recorded"}</p>
        <p className="mt-1 text-mist-500">{formatDateTime(e.lastAttemptAt)}</p>
      </div>
    ),
  },
  {
    key: "key",
    header: "Booking key",
    render: (e) => <span className="font-mono text-xs break-all">{e.idempotencyKey}</span>,
  },
  { key: "attempts", header: "Attempts", numeric: true, render: (e) => e.attempts },
  {
    key: "state",
    header: "Retry",
    render: (e) => (
      <div className="flex flex-col items-start gap-1 text-xs">
        {e.blockedReason ? (
          <>
            <Pill tone="bad">Blocked</Pill>
            <span>{formatAmountsInText(e.blockedReason)}</span>
          </>
        ) : (
          <Pill tone="info">Can retry</Pill>
        )}
        {e.reconciliation && <Pill tone="warn">{RECONCILIATION_KIND_LABEL[e.reconciliation]}</Pill>}
      </div>
    ),
  },
];

/**
 * Booking exceptions (PRD BKG-005), as the prototype's screen: bookings that failed or are
 * held. A retry happens on the case, under the booking rules, and reuses the same booking
 * key, so it can never create a second account or payment.
 */
export default function BookingExceptionsPage() {
  const me = useSession();
  const list = useApi<BookingExceptionView[]>("/operations/exceptions");
  const canRun = me.role === "LOAN_OPERATIONS" || me.role === "LOAN_OPERATIONS_SUPERVISOR";
  return (
    <>
      <PageHeader
        title="Booking exceptions"
        description="Bookings or disbursements that failed or are held. Open a case to retry it: retries reuse the same booking key, so a retry can never create a second account."
      />
      <div className="flex flex-col gap-5">
        <LoadState loading={list.loading && !list.data} error={list.error} onRetry={list.reload} />
        {list.data && (
          <Table
            caption="Booking exceptions"
            columns={COLUMNS}
            rows={list.data}
            rowKey={(e) => e.caseId}
            clickableRows
            empty={
              <EmptyState
                title="No exceptions"
                hint="Every booking that reached the checker went through."
              />
            }
          />
        )}
        <ReconciliationPanel canRun={canRun} onRan={() => void list.reload()} />
      </div>
    </>
  );
}
