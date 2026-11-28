"use client";

import {
  type DriftStatus,
  type DriftView,
  featureLabel,
  type ModelRegistryView,
  OVERRIDE_REASON_LABEL,
  type OverrideMonitorView,
  type Recommendation,
} from "@loan/core";
import {
  BarList,
  Card,
  type Column,
  EmptyState,
  formatDate,
  formatNumber,
  GradeTile,
  OUTCOME_LABEL,
  Pill,
  SimulatedLabel,
  StatCard,
  Table,
  type Tone,
} from "@loan/ui";

const RECOMMENDATION_WORD: Record<Recommendation, string> = {
  APPROVE: "Approve",
  COUNTER_OFFER: "Counter-offer",
  DECLINE: "Decline",
};

const DRIFT: Record<DriftStatus, { label: string; tone: Tone; meaning: string }> = {
  STABLE: { label: "Stable", tone: "ok", meaning: "Grades are spread as in the baseline." },
  MODERATE: {
    label: "Moderate shift",
    tone: "warn",
    meaning: "The grade mix has moved; watch the next windows.",
  },
  SIGNIFICANT: {
    label: "Significant shift",
    tone: "bad",
    meaning: "The grade mix has moved a lot; credit risk should review the scorecard.",
  },
  INSUFFICIENT_DATA: {
    label: "Not enough decisions",
    tone: "neutral",
    meaning: "Too few scored decisions in a window to judge drift.",
  },
};

type ScorecardRow = ModelRegistryView["scorecards"][number];

const SCORECARD_COLUMNS: Column<ScorecardRow>[] = [
  {
    key: "version",
    header: "Scorecard",
    render: (r) => (
      <span className="flex items-center gap-2">
        <span className="font-mono text-xs">{r.version}</span>
        {r.current && <Pill tone="info">Current</Pill>}
      </span>
    ),
  },
  {
    key: "decisions",
    header: "Decisions",
    numeric: true,
    render: (r) => formatNumber(r.decisions),
  },
  {
    key: "used",
    header: "Last used",
    render: (r) => (r.lastUsedAt ? formatDate(r.lastUsedAt) : "Not used yet"),
  },
  { key: "pd", header: "PD per grade", render: (r) => (r.hasPd ? "Yes" : "No") },
  {
    key: "check",
    header: "Prohibited features",
    render: (r) =>
      r.prohibitedFeatures.length === 0 ? (
        <Pill tone="ok">None used</Pill>
      ) : (
        <Pill tone="bad">Uses {r.prohibitedFeatures.map(featureLabel).join(", ")}</Pill>
      ),
  },
];

type RuleSetRow = ModelRegistryView["ruleSets"][number];

const RULE_SET_COLUMNS: Column<RuleSetRow>[] = [
  {
    key: "version",
    header: "Rule set",
    render: (r) => (
      <span className="flex items-center gap-2">
        <span className="font-mono text-xs">{r.version}</span>
        {r.current && <Pill tone="info">Current</Pill>}
      </span>
    ),
  },
  {
    key: "decisions",
    header: "Decisions",
    numeric: true,
    render: (r) => formatNumber(r.decisions),
  },
  {
    key: "used",
    header: "Last used",
    render: (r) => (r.lastUsedAt ? formatDate(r.lastUsedAt) : "Not used yet"),
  },
];

/** The registry: every scorecard and rule set decisions ran on, and the prohibited-features check. */
export function ModelRegistry({ registry }: { registry: ModelRegistryView }) {
  const current = registry.scorecards.find((s) => s.current);
  return (
    <Card title="Model registry">
      <Table
        caption="Scorecards, their use and the prohibited-features check"
        columns={SCORECARD_COLUMNS}
        rows={registry.scorecards}
        rowKey={(r) => r.version}
        empty="No scorecard is registered."
      />
      <div className="mt-4">
        <Table
          caption="Rule sets and their use"
          columns={RULE_SET_COLUMNS}
          rows={registry.ruleSets}
          rowKey={(r) => r.version}
          empty="No rule set is registered."
        />
      </div>
      {current && (
        <p className="mt-4 text-sm">
          <strong>The current scorecard reads:</strong>{" "}
          {current.features.map(featureLabel).join(", ")}.
        </p>
      )}
      <p className="mt-2 text-sm text-mist-600">
        <strong>No score may use:</strong>{" "}
        {registry.prohibitedFeatures.map(featureLabel).join(", ")}. A scorecard that lists one is
        refused when it scores. Age is a policy knockout, never a score factor.
      </p>
    </Card>
  );
}

/** How often people override the engine, why, and how often they agree where it only advised. */
export function OverrideMonitor({ monitor }: { monitor: OverrideMonitorView }) {
  if (monitor.recommendations === 0) {
    return (
      <Card title="Overrides · last 30 days" aside={<SimulatedLabel what="data" />}>
        <EmptyState
          title="No recommendations in this window"
          hint="Overrides appear here once loan officers recommend decisions on referred cases."
        />
      </Card>
    );
  }
  const rate = Math.round((monitor.overrides / monitor.recommendations) * 1000) / 10;
  const agreement =
    monitor.notLive.compared === 0
      ? null
      : Math.round((monitor.notLive.agreed / monitor.notLive.compared) * 1000) / 10;
  return (
    <Card title="Overrides · last 30 days" aside={<SimulatedLabel what="data" />}>
      <div className="grid gap-3 min-[700px]:grid-cols-3">
        <StatCard label="Recommendations" value={formatNumber(monitor.recommendations)} />
        <StatCard
          label="Overrides"
          value={`${rate.toFixed(1)}%`}
          note={`${monitor.overrides} of ${monitor.recommendations} changed the scored terms or declined (a recommended decline always counts, even where the engine also declined)`}
        />
        <StatCard
          label="Agreement where the engine only advised"
          value={agreement === null ? "—" : `${agreement.toFixed(1)}%`}
          note={
            agreement === null
              ? "No shadow, off or kill-switch decision with an engine approve or decline yet"
              : `${monitor.notLive.agreed} of ${monitor.notLive.compared} shadow, off or kill-switch decisions`
          }
        />
      </div>
      {monitor.byReason.length > 0 && (
        <div className="mt-4">
          <h3 className="mb-2 text-2xs font-bold tracking-wider text-mist-500 uppercase">
            Override reasons
          </h3>
          <BarList
            label="Overrides by reason code"
            bars={monitor.byReason.map((r) => ({
              label: `${r.code} · ${OVERRIDE_REASON_LABEL[r.code]}`,
              value: r.count,
              tone: "gold",
            }))}
          />
        </div>
      )}
      <div className="mt-4">
        <Table
          caption="The engine's outcome against the officer's recommendation"
          columns={[
            {
              key: "engine",
              header: "Engine",
              render: (r) => OUTCOME_LABEL[r.engineOutcome],
            },
            {
              key: "officer",
              header: "Officer recommended",
              render: (r) => RECOMMENDATION_WORD[r.recommendation],
            },
            {
              key: "count",
              header: "Cases",
              numeric: true,
              render: (r) => formatNumber(r.count),
            },
          ]}
          rows={monitor.matrix}
          rowKey={(r) => `${r.engineOutcome}-${r.recommendation}`}
          empty="No recommendations."
        />
      </div>
    </Card>
  );
}

/** Whether the grade mix of recent decisions has moved away from the baseline (PSI). */
export function DriftMonitor({ drift }: { drift: DriftView }) {
  const status = DRIFT[drift.status];
  return (
    <Card
      title="Score drift"
      aside={
        <span className="flex items-center gap-2">
          <SimulatedLabel what="data" />
          <Pill tone={status.tone}>{status.label}</Pill>
        </span>
      }
    >
      <p className="text-sm">
        {status.meaning}{" "}
        {drift.psi === null
          ? `PSI not computed: baseline ${drift.baseline.decisions}, recent ${drift.recent.decisions} of the ${drift.minimumDecisions} scored decisions needed per window.`
          : `Population stability index ${drift.psi} (under 0.10 stable, 0.25 and over significant).`}
      </p>
      <div className="mt-4">
        <Table
          caption="Share of scored decisions per grade, baseline against recent"
          columns={[
            { key: "grade", header: "Grade", render: (g) => <GradeTile grade={g.grade} /> },
            {
              key: "baseline",
              header: `Baseline (${drift.baseline.decisions})`,
              numeric: true,
              render: (g) => `${g.baselinePct.toFixed(1)}%`,
            },
            {
              key: "recent",
              header: `Recent (${drift.recent.decisions})`,
              numeric: true,
              render: (g) => `${g.recentPct.toFixed(1)}%`,
            },
          ]}
          rows={drift.grades}
          rowKey={(g) => g.grade}
          empty="No grades."
        />
      </div>
      <p className="mt-3 text-xs text-mist-500">
        Baseline {formatDate(drift.baseline.from)} to {formatDate(drift.baseline.to)}, mean score{" "}
        {drift.baseline.meanScore ?? "none"}; recent {formatDate(drift.recent.from)} to{" "}
        {formatDate(drift.recent.to)}, mean score {drift.recent.meanScore ?? "none"}.
      </p>
    </Card>
  );
}
