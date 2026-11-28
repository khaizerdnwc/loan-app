"use client";

import {
  type LatestReconciliationView,
  NO_FEED_RECORDS,
  PROVIDER_MODE_LABEL,
  RECONCILIATION_KIND_LABEL,
  type ReconciliationFinding,
  type ReconciliationRunView,
} from "@loan/core";
import {
  Button,
  Callout,
  Card,
  type Column,
  formatAmountsInText,
  formatDateTime,
  formatNumber,
  formatPeso,
  KeyValues,
  Pill,
  ROW_LINK,
  SimulatedLabel,
  Table,
} from "@loan/ui";
import Link from "next/link";
import { useEffect, useState } from "react";
import { LoadState } from "@/components/load-state";
import { api, errorMessage } from "@/lib/api";
import { useApi } from "@/lib/use-api";

function amounts(core: string | null, lending: string | null) {
  return (
    <div className="text-xs">
      <p>Core: {core ? formatPeso(core) : "none"}</p>
      <p>Lending: {lending ? formatPeso(lending) : "none"}</p>
    </div>
  );
}

const COLUMNS: Column<ReconciliationFinding>[] = [
  {
    key: "kind",
    header: "Finding",
    render: (f) => (
      <Pill tone={f.kind === "CORE_ACCOUNT_UNDISBURSED" ? "warn" : "bad"}>
        {RECONCILIATION_KIND_LABEL[f.kind]}
      </Pill>
    ),
  },
  {
    key: "case",
    header: "Case",
    render: (f) =>
      f.caseId && f.caseReference ? (
        <Link
          {...ROW_LINK}
          href={`/cases/${f.caseId}`}
          className="font-mono text-xs underline-offset-2 hover:underline"
        >
          {f.caseReference}
        </Link>
      ) : (
        <span className="text-xs text-mist-500">No case</span>
      ),
  },
  {
    key: "key",
    header: "Booking key",
    render: (f) => <span className="font-mono text-xs break-all">{f.idempotencyKey}</span>,
  },
  {
    key: "account",
    header: "Account",
    render: (f) => (
      <span className="font-mono text-xs">
        {f.coreAccountNumber ?? f.lendingAccountNumber ?? "—"}
      </span>
    ),
  },
  {
    key: "amounts",
    header: "Amounts",
    numeric: true,
    render: (f) => amounts(f.coreAmount, f.lendingAmount),
  },
  {
    key: "detail",
    header: "What it means",
    render: (f) => <span>{formatAmountsInText(f.detail)}</span>,
  },
];

/**
 * Reconciliation (PRD BKG-005): lending's booking records against core banking's account feed
 * and the payment rail's feed, by booking key. Running it records a run and changes nothing
 * else, so it needs no confirmation; Compliance reads it but cannot run it.
 */
export function ReconciliationPanel({
  canRun,
  onRan,
}: {
  canRun: boolean;
  onRan?: (run: ReconciliationRunView) => void;
}) {
  const latest = useApi<LatestReconciliationView>("/operations/reconciliation/latest");
  const [run, setRun] = useState<ReconciliationRunView | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (latest.data) setRun(latest.data.run);
  }, [latest.data]);

  async function reconcileNow() {
    setBusy(true);
    setError(null);
    try {
      const next = await api<ReconciliationRunView>("/operations/reconciliation/runs", {
        method: "POST",
      });
      setRun(next);
      onRan?.(next);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card title="Reconciliation" aside={<SimulatedLabel what="core banking and payments" />}>
      {!latest.data ? (
        <LoadState loading={latest.loading} error={latest.error} onRetry={latest.reload} />
      ) : (
        <div className="flex flex-col gap-4">
          {run ? (
            <>
              <p className="text-sm text-mist-500">
                Last run {formatDateTime(run.runAt)} by {run.runByName} ·{" "}
                {run.providerMode === NO_FEED_RECORDS
                  ? "the feeds held no records"
                  : `${PROVIDER_MODE_LABEL[run.providerMode] ?? run.providerMode} providers`}
                {run.summary.settledDuringRun > 0 &&
                  ` · ${formatNumber(run.summary.settledDuringRun)} booking(s) completed during the run and are not reported`}
              </p>
              <KeyValues
                items={[
                  { label: "Bookings sent", value: formatNumber(run.summary.bookingRequests) },
                  { label: "Confirmed by core", value: formatNumber(run.summary.matched) },
                  { label: "Findings", value: formatNumber(run.summary.findings) },
                  { label: "Duplicates detected", value: formatNumber(run.summary.duplicates) },
                ]}
              />
              <Table
                caption="Reconciliation findings"
                columns={COLUMNS}
                rows={run.findings}
                rowKey={(f) => `${f.kind}:${f.idempotencyKey}`}
                empty="Every booking reconciled with core banking and the payment rail."
                clickableRows
                rowClickable={(f) => Boolean(f.caseId && f.caseReference)}
              />
            </>
          ) : (
            <p className="text-sm text-mist-500">
              No reconciliation has run yet.
              {canRun ? " Run one to compare lending's bookings with core and the rail." : ""}
            </p>
          )}
          {error && (
            <Callout tone="bad" alert>
              {error}
            </Callout>
          )}
          {canRun ? (
            <div>
              <Button variant="primary" busy={busy} onClick={reconcileNow}>
                Run reconciliation
              </Button>
            </div>
          ) : (
            <p className="text-xs text-mist-500">Loan operations runs the reconciliation.</p>
          )}
        </div>
      )}
    </Card>
  );
}
