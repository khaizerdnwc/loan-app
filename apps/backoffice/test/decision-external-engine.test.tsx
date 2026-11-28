import type { DecisionRecordView } from "@loan/core";
import { render, screen } from "@testing-library/react";
import { DecisionPanel } from "@/components/case/decision-panel";

/**
 * EX-3: the decision panel says who decided when the client's decision engine (simulated)
 * took part (PRD DEC-008), names it among the simulated sources, and sets its reference apart.
 */
const decision = (patch: Partial<DecisionRecordView>): DecisionRecordView => ({
  id: "d1",
  caseId: "case-1",
  outcome: "AUTO_DECLINE",
  engineOutcome: "AUTO_DECLINE",
  automationMode: "LIVE",
  killSwitch: false,
  score: 780,
  grade: "A",
  ruleSetVersion: "RS-PL-4",
  scorecardVersion: "SC-PL-2",
  ruleResults: [
    {
      id: "EX-ENGINE",
      name: "External decision engine approves (used instead of the score)",
      kind: "REFERRAL",
      result: "FAIL",
      value: "auto-decline; client codes: EXT-LOW-SCORE; ref EXT-3F8B2C6D1A09",
    },
  ],
  scoreContributions: [],
  reasonCodes: [
    {
      code: "R25",
      staff: "The external decision engine declined the application",
      borrower: "Your application does not meet our lending requirements.",
    },
  ],
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
  externalEngine: {
    role: "INSTEAD",
    outcome: "AUTO_DECLINE",
    reference: "EXT-3F8B2C6D1A09",
    agreed: null,
  },
  ...patch,
});

describe("DecisionPanel with the client's decision engine (EX-3)", () => {
  it("instead: says the client engine decided and the built-in score is only for pricing", () => {
    render(<DecisionPanel decision={decision({})} />);
    expect(
      screen.getByText(
        "Decided by the client's decision engine (simulated), instead of the score; the built-in score and grade are shown for pricing.",
      ),
    ).toBeInTheDocument();
    expect(screen.getByText(/client decision engine data/)).toBeInTheDocument();
    // The client's codes are named as the client's, and the reference is set in monospace.
    expect(screen.getByText(/client codes: EXT-LOW-SCORE/)).toBeInTheDocument();
    expect(screen.getByText("EXT-3F8B2C6D1A09").className).toMatch(/font-mono/);
  });

  it("alongside: says whether the two engines agreed", () => {
    const { rerender } = render(
      <DecisionPanel
        decision={decision({
          outcome: "AUTO_APPROVE",
          externalEngine: {
            role: "ALONGSIDE",
            outcome: "AUTO_APPROVE",
            reference: "EXT-1",
            agreed: true,
          },
        })}
      />,
    );
    expect(
      screen.getByText("Checked alongside the client's decision engine (simulated): agreed."),
    ).toBeInTheDocument();
    rerender(
      <DecisionPanel
        decision={decision({
          outcome: "REFER",
          externalEngine: {
            role: "ALONGSIDE",
            outcome: "AUTO_DECLINE",
            reference: "EXT-1",
            agreed: false,
          },
        })}
      />,
    );
    expect(
      screen.getByText("Checked alongside the client's decision engine (simulated): disagreed."),
    ).toBeInTheDocument();
  });

  it("an engine that could not answer, and no engine at all", () => {
    const { rerender } = render(
      <DecisionPanel
        decision={decision({
          outcome: "REFER",
          externalEngine: { role: "INSTEAD", outcome: null, reference: null, agreed: null },
        })}
      />,
    );
    expect(screen.getByText(/could not answer, so a person decides/)).toBeInTheDocument();
    rerender(<DecisionPanel decision={decision({ externalEngine: null, ruleResults: [] })} />);
    expect(screen.queryByText(/client's decision engine/)).toBeNull();
    expect(screen.getByText(/bureau, screening and fraud check data/)).toBeInTheDocument();
  });
});
