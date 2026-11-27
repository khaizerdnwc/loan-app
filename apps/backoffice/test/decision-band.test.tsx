import type { DecisionRecordView } from "@loan/core";
import { render, screen } from "@testing-library/react";
import { DecisionPanel } from "@/components/case/decision-panel";

/**
 * Regression: the score band is drawn from the band edges the API sends with the decision
 * (from the record's own rule set), not from a table of rule-set versions kept in the UI. That
 * table stopped at RS-PL-2, so every RS-PL-3 decision lost its band (F1, F2 journeys).
 */
const decision = (patch: Partial<DecisionRecordView>) =>
  ({
    id: "d1",
    caseId: "case-1",
    outcome: "AUTO_APPROVE",
    engineOutcome: "AUTO_APPROVE",
    automationMode: "LIVE",
    killSwitch: false,
    score: 742,
    grade: "A",
    ruleSetVersion: "RS-PL-3",
    scorecardVersion: "SC-PL-2",
    ruleResults: [],
    scoreContributions: [],
    reasonCodes: [],
    referralTriggers: [],
    debtToIncome: "0.1154",
    monthlyRate: "0.0120",
    providerMode: "SIMULATED",
    inputs: {},
    inputsHash: "h",
    createdAt: "2026-11-28T01:00:00.000Z",
    pd: "0.0080",
    recommendedAmount: "150000.00",
    latencyMs: 400,
    scoreBand: { declineBelow: 600, approveFrom: 700 },
    ...patch,
  }) as DecisionRecordView;

describe("the decision's score band comes from the API (F1-1)", () => {
  it("an RS-PL-3 decision shows its score on the band", () => {
    render(<DecisionPanel decision={decision({})} />);
    expect(
      screen.getByLabelText(/^Score 742 on a scale .* decline below 600, .* approve from 700$/),
    ).toBeInTheDocument();
  });

  it("uses the edges the API sends, whatever the version is called", () => {
    render(
      <DecisionPanel
        decision={decision({
          ruleSetVersion: "RS-PL-9",
          scoreBand: { declineBelow: 620, approveFrom: 720 },
        })}
      />,
    );
    expect(screen.getByLabelText(/decline below 620, .* approve from 720$/)).toBeInTheDocument();
  });

  it("an unscored decision shows no band", () => {
    render(<DecisionPanel decision={decision({ score: null, grade: null })} />);
    expect(screen.queryByLabelText(/^Score /)).toBeNull();
  });
});
