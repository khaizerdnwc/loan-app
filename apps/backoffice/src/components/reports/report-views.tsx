"use client";

import {
  type CaseStatus,
  type DecisionMixReport,
  type OriginationFunnelReport,
  OVERRIDE_REASON_LABEL,
  type OverrideReason,
  STATUS_LABEL,
} from "@loan/core";
import {
  type Bar,
  BarList,
  type BarTone,
  Card,
  EmptyState,
  formatDate,
  formatNumber,
  formatPeso,
  StatCard,
} from "@loan/ui";
import { PERIODS, percent } from "@/lib/reports";

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

const DAY_MS = 86_400_000;
/** The longest period the screens offer, in days. */
const LONGEST = Math.max(...PERIODS.map((p) => Number(p.value)));

/** How many days a report covers, both ends included ("2026-11-22" to "2026-11-28" is 7). */
export function periodDays(p: { from: string; to: string }): number {
  return Math.round((Date.parse(p.to) - Date.parse(p.from)) / DAY_MS) + 1;
}

/**
 * No data for the period: the shared empty state. The hint to widen the period shows only
 * when a longer one exists; at the longest it would point nowhere.
 */
function Empty({ children, period }: { children: string; period: { from: string; to: string } }) {
  return (
    <EmptyState
      title={children}
      hint={periodDays(period) < LONGEST ? "Choose a longer period to see more." : undefined}
    />
  );
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
            <Empty period={r.period}>No decisions in this period.</Empty>
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
            <Empty period={r.period}>No referrals in this period.</Empty>
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
            <Empty period={r.period}>No reason codes in this period.</Empty>
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
            <Empty period={r.period}>No overrides in this period.</Empty>
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
            <Empty period={r.period}>No applications started in this period.</Empty>
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
            <Empty period={r.period}>No applications started in this period.</Empty>
          )}
        </Card>
      </div>
    </div>
  );
}
