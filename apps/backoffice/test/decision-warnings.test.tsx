import type { DecisionRecordView } from "@loan/core";
import { render, screen, within } from "@testing-library/react";
import { DecisionPanel } from "@/components/case/decision-panel";

/**
 * D-18: warning rules (RS-PL-5) are listed on their own, said not to refer, and kept out of
 * the policy rules that decide the outcome.
 */
const decision = (patch: Partial<DecisionRecordView>): DecisionRecordView => ({
  id: "d1",
  caseId: "case-1",
  outcome: "AUTO_APPROVE",
  engineOutcome: "AUTO_APPROVE",
  automationMode: "LIVE",
  killSwitch: false,
  score: 717,
  grade: "B",
  ruleSetVersion: "RS-PL-5",
  scorecardVersion: "SC-PL-2",
  ruleResults: [
    {
      id: "SC-BAND",
      name: "Score band (decline below 600, approve from 700)",
      kind: "REFERRAL",
      result: "PASS",
      value: "score 717 (B)",
    },
    {
      id: "WN-UTILISATION",
      name: "Credit utilisation at most 80%",
      kind: "WARNING",
      result: "FAIL",
      value: "81%",
    },
    {
      id: "WN-EMPLOYMENT",
      name: "Employed 12 months or more",
      kind: "WARNING",
      result: "PASS",
      value: "30 months",
    },
  ],
  scoreContributions: [],
  reasonCodes: [],
  referralTriggers: [],
  debtToIncome: "0.1154",
  monthlyRate: "0.0140",
  providerMode: "SIMULATED",
  inputs: {},
  inputsHash: "h",
  createdAt: "2026-11-28T01:00:00.000Z",
  pd: "0.0150",
  recommendedAmount: "150000.00",
  latencyMs: 400,
  scoreBand: { declineBelow: 600, approveFrom: 700 },
  externalEngine: null,
  ...patch,
});

describe("DecisionPanel warnings (D-18)", () => {
  it("lists the warnings apart, says they do not refer, and keeps them out of the policy rules", () => {
    render(<DecisionPanel decision={decision({})} />);
    const list = screen.getByRole("list", { name: "Warnings" });
    expect(within(list).getByText("Credit utilisation at most 80%")).toBeInTheDocument();
    expect(within(list).getByText("Warning")).toBeInTheDocument();
    expect(within(list).getByText("81%")).toBeInTheDocument();
    expect(within(list).getByText("No warning")).toBeInTheDocument();
    expect(
      screen.getByText(/does not refer or decline the application on its own/),
    ).toBeInTheDocument();
    // Not repeated among the rules that decide the outcome.
    expect(screen.getAllByText("Credit utilisation at most 80%")).toHaveLength(1);
    expect(
      screen.getByText("Score band (decline below 600, approve from 700)"),
    ).toBeInTheDocument();
  });

  it("a decision without warning rules (before RS-PL-5) shows no warnings section", () => {
    render(
      <DecisionPanel
        decision={decision({
          ruleSetVersion: "RS-PL-4",
          ruleResults: [
            {
              id: "SC-BAND",
              name: "Score band (decline below 600, approve from 700)",
              kind: "REFERRAL",
              result: "PASS",
              value: "score 742 (A)",
            },
          ],
        })}
      />,
    );
    expect(screen.queryByRole("list", { name: "Warnings" })).toBeNull();
  });
});
