"use client";

import type { DecisionRecordView } from "@loan/core";
import {
  Card,
  formatMonthlyRate,
  formatRatioPercent,
  GradeTile,
  OutcomePill,
  Pill,
  ScoreBand,
  SimulatedLabel,
} from "@loan/ui";

/**
 * Band edges of rule set RS-PL-1 (docs/ASSUMPTIONS.md). The contract does not carry them yet,
 * so they are shown for RS-PL-1 only; another version falls back to the rule result text.
 */
const BANDS: Record<string, { declineBelow: number; approveFrom: number }> = {
  "RS-PL-1": { declineBelow: 600, approveFrom: 700 },
};

const RESULT: Record<
  DecisionRecordView["ruleResults"][number]["result"],
  { mark: string; label: string; tone: string }
> = {
  PASS: { mark: "✓", label: "Pass", tone: "text-ok-700" },
  FAIL: { mark: "✕", label: "Fail", tone: "text-bad-700" },
  NOT_EVALUATED: { mark: "–", label: "Not evaluated", tone: "text-mist-500" },
};

export function DecisionPanel({ decision }: { decision: DecisionRecordView }) {
  const bands = BANDS[decision.ruleSetVersion];
  return (
    <Card
      title="Decision summary"
      aside={
        <span className="flex items-center gap-2">
          <SimulatedLabel what="bureau and screening data" />
          <span className="font-mono">
            {decision.ruleSetVersion} · {decision.scorecardVersion}
          </span>
        </span>
      }
    >
      <div className="flex flex-wrap items-center gap-4">
        <OutcomePill outcome={decision.outcome} />
        {decision.score !== null ? (
          <>
            <span className="text-display leading-none font-extrabold text-ink-900">
              {decision.score}
            </span>
            <GradeTile grade={decision.grade} />
          </>
        ) : (
          <span className="text-sm">
            Not scored: a knockout rule or an unavailable service ended the decision before scoring.
          </span>
        )}
        <dl className="ml-auto grid grid-cols-2 gap-x-6 gap-y-1 text-sm">
          <dt className="text-mist-500">Debt-to-income</dt>
          <dd className="text-right text-ink-900">{formatRatioPercent(decision.debtToIncome)}</dd>
          <dt className="text-mist-500">Rate for grade</dt>
          <dd className="text-right text-ink-900">{formatMonthlyRate(decision.monthlyRate)}</dd>
        </dl>
      </div>

      {decision.score !== null && bands && (
        <div className="mt-5">
          <ScoreBand
            score={decision.score}
            declineBelow={bands.declineBelow}
            approveFrom={bands.approveFrom}
          />
        </div>
      )}

      {decision.reasonCodes.length > 0 && (
        <div className="mt-5">
          <h3 className="text-2xs font-bold tracking-wider text-mist-500 uppercase">Reasons</h3>
          <ul className="mt-2 flex flex-col gap-2">
            {decision.reasonCodes.map((r) => (
              <li key={r.code} className="flex gap-3 text-sm">
                <span className="font-mono text-xs text-mist-500">{r.code}</span>
                <span>
                  <span className="text-ink-900">{r.staff}</span>
                  <span className="block text-xs text-mist-500">Borrower sees: “{r.borrower}”</span>
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {decision.referralTriggers.length > 0 && (
        <div className="mt-5 rounded-btn bg-gold-050 px-4 py-3 text-sm text-gold-700">
          <strong>Referred because:</strong> {decision.referralTriggers.join(" · ")}
        </div>
      )}

      <div className="mt-5 grid gap-5 min-[1100px]:grid-cols-2">
        <div>
          <h3 className="text-2xs font-bold tracking-wider text-mist-500 uppercase">
            Policy rules
          </h3>
          <ul className="mt-2 flex flex-col divide-y divide-line">
            {decision.ruleResults.map((rule) => {
              const r = RESULT[rule.result];
              return (
                <li key={rule.id} className="flex items-center justify-between gap-3 py-2 text-sm">
                  <span className="flex items-center gap-2">
                    <span aria-hidden="true" className={`font-bold ${r.tone}`}>
                      {r.mark}
                    </span>
                    <span>
                      {rule.name}
                      <span className="sr-only"> — {r.label}</span>
                    </span>
                    {rule.kind === "KNOCKOUT" && <Pill>Knockout</Pill>}
                  </span>
                  <span className="text-right text-xs text-mist-500 tabular-nums">
                    {rule.value}
                  </span>
                </li>
              );
            })}
          </ul>
        </div>
        {decision.scoreContributions.length > 0 && (
          <div>
            <h3 className="text-2xs font-bold tracking-wider text-mist-500 uppercase">
              How the score was built
            </h3>
            <ul className="mt-2 flex flex-col divide-y divide-line">
              {decision.scoreContributions.map((c) => (
                <li key={c.factor} className="flex items-center justify-between gap-3 py-2 text-sm">
                  <span>
                    {c.factor}
                    <span className="block text-xs text-mist-500">{c.detail}</span>
                  </span>
                  <span
                    className={`tabular-nums ${c.points < 0 ? "text-bad-700" : "text-ink-900"}`}
                  >
                    {c.points > 0 && c.factor !== "Base points" ? `+${c.points}` : c.points}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </Card>
  );
}
