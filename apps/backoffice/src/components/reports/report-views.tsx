"use client";

import {
  type CaseStatus,
  type DecisionMixReport,
  type OriginationFunnelReport,
  OVERRIDE_REASON_LABEL,
  type OverrideReason,
  STATUS_LABEL,
  type TurnaroundReport,
  type TurnaroundStage,
} from "@loan/core";
import {
  type Bar,
  BarList,
  type BarTone,
  Card,
  type Column,
  formatDate,
  formatNumber,
  formatPeso,
  StagePill,
  StatCard,
  Table,
} from "@loan/ui";
import { businessDuration, calendarNote } from "@/components/sla";
import { percent } from "@/lib/reports";

const OUTCOME: Record<string, { label: string; tone: BarTone }> = {
  AUTO_APPROVE: { label: "Auto-approve", tone: "ok" },
  REFER: { label: "Refer", tone: "gold" },
  AUTO_DECLINE: { label: "Auto-decline", tone: "bad" },
};

const STAGE_LABEL: Record<OriginationFunnelReport["stages"][number]["key"], string> = {
  STARTED: "Started",
  SUBMITTED: "Submitted",
  APPROVED: "Approved",
  DISBURSED: "Disbursed",
};

function periodLine(p: { from: string; to: string }): string {
  return `${formatDate(p.from)} – ${formatDate(p.to)}`;
}

function Empty({ children }: { children: string }) {
  return <p className="text-sm text-mist-500">{children}</p>;
}

/** RPT-003: the decision mix, from stored decision records. */
export function DecisionMixView({ report: r }: { report: DecisionMixReport }) {
  const mix: Bar[] = r.outcomes.map((o) => ({
    label: OUTCOME[o.key]?.label ?? o.key,
    value: o.count,
    display: `${percent(o.share)} · ${formatNumber(o.count)}`,
    tone: OUTCOME[o.key]?.tone,
  }));
  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-4 sm:grid-cols-2 min-[1100px]:grid-cols-4">
        <StatCard label="Decisions" value={formatNumber(r.decisions)} note={periodLine(r.period)} />
        <StatCard
          label="Straight-through rate"
          value={percent(r.straightThroughRate)}
          note="Decided with no human touch"
        />
        <StatCard
          label="Override rate"
          value={percent(r.overrideRate)}
          note={`${formatNumber(r.overrides)} of ${formatNumber(r.recommendations)} recommendations`}
        />
        <StatCard
          label="Referred"
          value={formatNumber(r.outcomes.find((o) => o.key === "REFER")?.count ?? 0)}
          note="Sent to a loan officer"
        />
      </div>
      <div className="grid gap-4 min-[1100px]:grid-cols-2">
        <Card title="Decision mix">
          {r.decisions ? (
            <BarList label="Decision mix" bars={mix} />
          ) : (
            <Empty>No decisions in this period.</Empty>
          )}
        </Card>
        <Card title="Referral triggers">
          {r.referralTriggers.length ? (
            <BarList
              label="Referral triggers"
              bars={r.referralTriggers.map((t) => ({
                label: t.key,
                value: t.count,
                display: formatNumber(t.count),
                tone: "gold",
              }))}
            />
          ) : (
            <Empty>No referrals in this period.</Empty>
          )}
        </Card>
        <Card title="Reason codes">
          {r.reasonCodes.length ? (
            <BarList
              label="Reason codes"
              bars={r.reasonCodes.map((c) => ({
                label: c.label ? `${c.key} · ${c.label}` : c.key,
                value: c.count,
                display: formatNumber(c.count),
              }))}
            />
          ) : (
            <Empty>No reason codes in this period.</Empty>
          )}
        </Card>
        <Card title="Overrides by reason">
          {r.overrideReasons.length ? (
            <BarList
              label="Overrides by reason"
              bars={r.overrideReasons.map((o) => ({
                label: OVERRIDE_REASON_LABEL[o.key as OverrideReason]
                  ? `${o.key} · ${OVERRIDE_REASON_LABEL[o.key as OverrideReason]}`
                  : o.key,
                value: o.count,
                display: formatNumber(o.count),
                tone: "gold",
              }))}
            />
          ) : (
            <Empty>No overrides in this period.</Empty>
          )}
        </Card>
      </div>
    </div>
  );
}

/** RPT-001: the origination funnel, from the applications started in the period. */
export function FunnelView({ report: r }: { report: OriginationFunnelReport }) {
  const started = r.stages[0]?.count ?? 0;
  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-4 sm:grid-cols-2 min-[1100px]:grid-cols-4">
        {r.stages.map((s, i) => {
          const previous = STAGE_LABEL[r.stages[i - 1]?.key ?? "STARTED"].toLowerCase();
          return (
            <StatCard
              key={s.key}
              label={STAGE_LABEL[s.key]}
              value={formatNumber(s.count)}
              note={
                i === 0
                  ? periodLine(r.period)
                  : s.key === "DISBURSED"
                    ? `${percent(s.conversion)} of approved · ${formatPeso(r.disbursedAmount)}`
                    : `${percent(s.conversion)} of ${previous}`
              }
            />
          );
        })}
      </div>
      <div className="grid gap-4 min-[1100px]:grid-cols-2">
        <Card title="Funnel">
          {started ? (
            <BarList
              label="Funnel"
              max={started}
              bars={r.stages.map((s) => ({
                label: STAGE_LABEL[s.key],
                value: s.count,
                display: formatNumber(s.count),
              }))}
            />
          ) : (
            <Empty>No applications started in this period.</Empty>
          )}
        </Card>
        <Card title="Where they are now">
          {r.byStatus.length ? (
            <BarList
              label="Where they are now"
              bars={r.byStatus.map((s) => ({
                label: STATUS_LABEL[s.key as CaseStatus] ?? s.key,
                value: s.count,
                display: `${formatNumber(s.count)} · ${percent(s.share)}`,
                tone: "gold",
              }))}
            />
          ) : (
            <Empty>No applications started in this period.</Empty>
          )}
        </Card>
      </div>
    </div>
  );
}

const businessTime = (m: number | null) => (m === null ? "—" : businessDuration(m));

const TURNAROUND_COLUMNS: Column<TurnaroundStage>[] = [
  { key: "stage", header: "Stage", render: (s) => <StagePill status={s.status} /> },
  { key: "visits", header: "Visits", numeric: true, render: (s) => formatNumber(s.visits) },
  { key: "median", header: "Median", numeric: true, render: (s) => businessTime(s.medianMinutes) },
  {
    key: "p90",
    header: "90th percentile",
    numeric: true,
    render: (s) => businessTime(s.p90Minutes),
  },
  { key: "target", header: "SLA", numeric: true, render: (s) => businessTime(s.targetMinutes) },
  {
    key: "within",
    header: "Within SLA",
    numeric: true,
    render: (s) => (s.withinTargetShare === null ? "—" : percent(s.withinTargetShare)),
  },
];

/** RPT-002: business time per stage for the stage visits that ended in the period. */
export function TurnaroundView({ report: r }: { report: TurnaroundReport }) {
  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard
          label="Open past SLA"
          value={formatNumber(r.openNow.breached)}
          note="Right now, in a stage with an SLA"
        />
        <StatCard
          label="Open at risk"
          value={formatNumber(r.openNow.atRisk)}
          note="2 business hours or less left"
        />
        <StatCard label="Open on track" value={formatNumber(r.openNow.onTrack)} />
      </div>
      <Card title="Time per stage">
        <p className="mb-3 text-sm text-mist-500">
          Business time: Monday to Friday, {r.businessDay.start}–{r.businessDay.end} Manila, less
          holidays. Stage visits that ended {periodLine(r.period)}.
        </p>
        <Table
          caption="Business time per stage"
          columns={TURNAROUND_COLUMNS}
          rows={r.stages}
          rowKey={(s) => s.status}
          empty="No stages with an SLA."
        />
        {r.holidays.length > 0 && (
          <p className="mt-3 text-xs text-mist-500">
            Holidays skipped: {r.holidays.map((h) => `${formatDate(h.date)} ${h.name}`).join(" · ")}
          </p>
        )}
        {calendarNote(r.holidayCalendarEnds, r.period.to) && (
          <p className="mt-2 text-xs text-gold-700">
            {calendarNote(r.holidayCalendarEnds, r.period.to)}
          </p>
        )}
      </Card>
    </div>
  );
}
