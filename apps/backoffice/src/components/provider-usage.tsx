"use client";

import type { CircuitState, DecisionLatencyView, ProviderUsageView, ServiceName } from "@loan/core";
import {
  Card,
  type Column,
  formatDateTime,
  formatPeso,
  formatSeconds,
  Pill,
  SimulatedLabel,
  Table,
  type Tone,
} from "@loan/ui";
import { LoadState } from "@/components/load-state";
import { useApi } from "@/lib/use-api";

const SERVICE_LABEL: Partial<Record<ServiceName, string>> = {
  CREDIT_BUREAU: "Credit bureau",
  KYC_AML: "KYC / AML screening",
  FRAUD: "Fraud signals",
};

const CIRCUIT: Record<CircuitState, { label: string; tone: Tone }> = {
  CLOSED: { label: "Calling", tone: "ok" },
  OPEN: { label: "Paused · applications referred", tone: "bad" },
  HALF_OPEN: { label: "Trying again", tone: "warn" },
};

type Row = ProviderUsageView["services"][number];

const COLUMNS: Column<Row>[] = [
  { key: "service", header: "Service", render: (r) => SERVICE_LABEL[r.service] ?? r.service },
  { key: "attempts", header: "Attempts", numeric: true, render: (r) => r.attempts },
  { key: "failed", header: "Failed", numeric: true, render: (r) => r.failed },
  { key: "short", header: "Skipped (paused)", numeric: true, render: (r) => r.shortCircuited },
  { key: "cache", header: "Reused report", numeric: true, render: (r) => r.cacheHits },
  { key: "cost", header: "Cost", numeric: true, render: (r) => formatPeso(r.cost) },
  {
    key: "circuit",
    header: "Circuit",
    render: (r) => (
      <span className="flex flex-col items-start gap-0.5">
        <Pill tone={CIRCUIT[r.circuit.state].tone}>{CIRCUIT[r.circuit.state].label}</Pill>
        {r.circuit.openUntil && (
          <span className="text-xs text-mist-500">
            Calls resume after {formatDateTime(r.circuit.openUntil)}
          </span>
        )}
      </span>
    ),
  },
];

/**
 * The decision's provider calls over the last 30 days (PRD IH-003, IH-005, IH-006): attempts
 * with retries, failures, calls skipped by an open circuit, reused bureau reports and the
 * simulated cost; and the decision latency against the 60-second target (NFR-003).
 * Administrators and compliance only (the API refuses everyone else).
 */
export function ProviderUsage() {
  const usage = useApi<ProviderUsageView>("/providers/usage");
  const latency = useApi<DecisionLatencyView>("/decisions/latency");
  return (
    <div className="mt-6 grid gap-4 min-[1100px]:grid-cols-[2fr_1fr]">
      <Card title="Decision provider calls · last 30 days" aside={<SimulatedLabel what="prices" />}>
        <LoadState
          loading={usage.loading && !usage.data}
          error={usage.error}
          onRetry={usage.reload}
        />
        {usage.data && (
          <>
            <Table
              caption="Decision provider calls, failures, reuse and cost"
              columns={COLUMNS}
              rows={usage.data.services}
              rowKey={(r) => r.service}
              empty="No provider calls yet."
            />
            <p className="mt-3 text-sm">
              Total simulated cost: <strong>{formatPeso(usage.data.totalCost)}</strong>. A failing
              call is retried twice with a growing wait; after five failed calls in a row a service
              is not called for a while, and applications are referred meanwhile.
            </p>
          </>
        )}
      </Card>
      <Card title="Decision latency · last 30 days" aside={<SimulatedLabel what="providers" />}>
        <LoadState
          loading={latency.loading && !latency.data}
          error={latency.error}
          onRetry={latency.reload}
        />
        {latency.data && latency.data.decisions === 0 && (
          <p className="text-sm text-mist-500">No decision has been measured in this window yet.</p>
        )}
        {latency.data && latency.data.decisions > 0 && latency.data.p95Ms !== null && (
          <p className="mb-3">
            {latency.data.p95Ms <= latency.data.targetP95Ms ? (
              <Pill tone="ok">Within target</Pill>
            ) : (
              <Pill tone="bad">Over target</Pill>
            )}
          </p>
        )}
        {latency.data && latency.data.decisions > 0 && (
          <dl className="grid grid-cols-2 gap-x-6 gap-y-1 text-sm">
            <dt className="text-mist-500">Decisions measured</dt>
            <dd className="text-right tabular-nums">{latency.data.decisions}</dd>
            <dt className="text-mist-500">Median</dt>
            <dd className="text-right tabular-nums">{formatSeconds(latency.data.p50Ms)}</dd>
            <dt className="text-mist-500">95th percentile</dt>
            <dd className="text-right tabular-nums">{formatSeconds(latency.data.p95Ms)}</dd>
            <dt className="text-mist-500">Slowest</dt>
            <dd className="text-right tabular-nums">{formatSeconds(latency.data.maxMs)}</dd>
            <dt className="text-mist-500">Target (95th percentile)</dt>
            <dd className="text-right tabular-nums">{formatSeconds(latency.data.targetP95Ms)}</dd>
          </dl>
        )}
      </Card>
    </div>
  );
}
