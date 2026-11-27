"use client";

import { AUTOMATION_MODE_LABEL, type DecisionRecordView } from "@loan/core";
import {
  Callout,
  Card,
  formatAmountsInText,
  formatMonthlyRate,
  formatRatioPercent,
  GradeTile,
  OUTCOME_LABEL,
  OutcomePill,
  Pill,
  ScoreBand,
  SimulatedLabel,
} from "@loan/ui";

/**
 * Band edges per rule set (docs/ASSUMPTIONS.md). The contract does not carry them yet, so they
 * are listed here; an unlisted version falls back to the rule result text.
 */
const BANDS: Record<string, { declineBelow: number; approveFrom: number }> = {
  "RS-PL-1": { declineBelow: 600, approveFrom: 700 },
  "RS-PL-2": { declineBelow: 600, approveFrom: 700 },
};

const RESULT: Record<
  DecisionRecordView["ruleResults"][number]["result"],
  { mark: string; label: string; tone: string }
> = {
  PASS: { mark: "✓", label: "Pass", tone: "bg-ok-050 text-ok-700" },
  FAIL: { mark: "✕", label: "Fail", tone: "bg-bad-050 text-bad-700" },
  NOT_EVALUATED: { mark: "–", label: "Not evaluated", tone: "bg-mist-100 text-mist-600" },
};

export function DecisionPanel({ decision }: { decision: DecisionRecordView }) {
  const bands = BANDS[decision.ruleSetVersion];
  return (
    <Card
      title="Decision summary"
      aside={
        <span className="flex items-center gap-2">
          <SimulatedLabel what="bureau, screening and fraud check data" />
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

      {(decision.automationMode !== "LIVE" || decision.killSwitch) && (
        <Callout
          tone="info"
          className="mt-5"
          lead={`${
            decision.killSwitch
              ? "Kill switch on"
              : `Automation ${AUTOMATION_MODE_LABEL[decision.automationMode].toLowerCase()}`
          }:`}
        >
          the engine&apos;s outcome was {OUTCOME_LABEL[decision.engineOutcome]}; a person decides
          this case.
        </Callout>
      )}

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
        <Callout tone="warn" lead="Referred because:" className="mt-5">
          {decision.referralTriggers.join(" · ")}
        </Callout>
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
                    <span
                      aria-hidden="true"
                      className={`grid size-5 shrink-0 place-items-center rounded-full text-2xs font-extrabold ${r.tone}`}
                    >
                      {r.mark}
                    </span>
                    <span>
                      {rule.name}
                      <span className="sr-only"> — {r.label}</span>
                    </span>
                    {rule.kind === "KNOCKOUT" && <Pill>Knockout</Pill>}
                  </span>
                  <span className="text-right text-xs text-mist-500 tabular-nums">
                    {formatAmountsInText(rule.value)}
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
