"use client";

import { AUTOMATION_MODE_LABEL, type DecisionRecordView } from "@loan/core";
import {
  Callout,
  Card,
  formatAmountsInText,
  formatMonthlyRate,
  formatPeso,
  formatRatioPercent,
  formatSeconds,
  GradeTile,
  KeyValues,
  OUTCOME_LABEL,
  OutcomePill,
  Pill,
  ScoreBand,
  SimulatedLabel,
} from "@loan/ui";

const RESULT: Record<
  DecisionRecordView["ruleResults"][number]["result"],
  { mark: string; label: string; tone: string }
> = {
  PASS: { mark: "✓", label: "Pass", tone: "bg-ok-050 text-ok-700" },
  FAIL: { mark: "✕", label: "Fail", tone: "bg-bad-050 text-bad-700" },
  NOT_EVALUATED: { mark: "–", label: "Not evaluated", tone: "bg-mist-100 text-mist-600" },
};

export function DecisionPanel({ decision }: { decision: DecisionRecordView }) {
  // The record's own rule set's band edges, from the API: no version table to fall behind.
  const bands = decision.scoreBand;
  return (
    <Card
      title="Decision summary"
      aside={
        <span className="flex items-center gap-2">
          <SimulatedLabel
            what={
              decision.externalEngine
                ? "bureau, screening, fraud check and client decision engine data"
                : "bureau, screening and fraud check data"
            }
          />
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
        {/* The prototype's facts beside the score (dl.kv): label over value. */}
        <KeyValues
          className="min-w-0 flex-1 basis-80"
          items={[
            { label: "Debt-to-income", value: formatRatioPercent(decision.debtToIncome) },
            { label: "Rate for grade", value: formatMonthlyRate(decision.monthlyRate) },
            ...(decision.pd
              ? [
                  {
                    label: `Probability of default, grade ${decision.grade} (12 months)`,
                    value: formatRatioPercent(decision.pd),
                  },
                ]
              : []),
            ...(decision.recommendedAmount
              ? [
                  {
                    label: "Affordable amount (engine)",
                    value: nothingAffordable(decision.recommendedAmount)
                      ? "None"
                      : formatPeso(decision.recommendedAmount),
                  },
                ]
              : []),
            ...(typeof decision.latencyMs === "number"
              ? [{ label: "Decided in", value: formatSeconds(decision.latencyMs) }]
              : []),
          ]}
        />
      </div>
      {decision.externalEngine && (
        <p className="mt-3 text-sm text-ink-900">{whoDecided(decision)}</p>
      )}
      {decision.recommendedAmount && (
        <p className="mt-3 text-xs text-mist-500">
          {nothingAffordable(decision.recommendedAmount)
            ? `Nothing is affordable at this grade's rate within the debt-service limit of ${decision.ruleSetVersion}.`
            : `Affordable amount: indicative, the most the applicant can repay, up to the amount asked, within the debt-service limit of ${decision.ruleSetVersion} at this grade's rate. Not an offer.`}
        </p>
      )}

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

      {decision.score !== null && !bands && (
        <p className="mt-5 text-sm text-mist-600">
          Score band not shown: this decision names rule set {decision.ruleSetVersion}, which this
          version of the system does not know, so its band edges cannot be drawn. The score and the
          rule results above are as recorded.
        </p>
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
                    {rule.id === "EX-ENGINE" ? (
                      <ExternalAnswer value={rule.value} />
                    ) : (
                      formatAmountsInText(rule.value)
                    )}
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

/**
 * Who decided, when the client's decision engine took part (PRD DEC-008): instead of the
 * score, the head of the panel would otherwise show a built-in score that did not decide.
 */
function whoDecided(decision: DecisionRecordView): string {
  const ext = decision.externalEngine;
  if (!ext) return "";
  const knockedOut = decision.ruleResults.some((r) => r.kind === "KNOCKOUT" && r.result === "FAIL");
  if (knockedOut) {
    return "A knockout rule declined this application; the client's decision engine (simulated) cannot overrule it.";
  }
  if (ext.outcome === null) {
    return "The client's decision engine (simulated) could not answer, so a person decides this case.";
  }
  if (ext.role === "INSTEAD") {
    return "Decided by the client's decision engine (simulated), instead of the score; the built-in score and grade are shown for pricing.";
  }
  return `Checked alongside the client's decision engine (simulated): ${ext.agreed ? "agreed" : "disagreed"}.`;
}

/** The EX-ENGINE rule's value, with the client engine's reference set in monospace. */
function ExternalAnswer({ value }: { value: string }) {
  const match = /^(.*?); ref ([^\s;]+)(.*)$/.exec(value);
  if (!match) return <>{value}</>;
  return (
    <>
      {match[1]}; ref <span className="font-mono">{match[2]}</span>
      {match[3]}
    </>
  );
}

/** The engine found no affordable amount ("0.00"): said in words, never shown as ₱0.00. */
function nothingAffordable(amount: string): boolean {
  // The API sends amounts as two-decimal strings (ADR 0019 R2), so zero is exactly "0.00".
  return amount === "0.00";
}
