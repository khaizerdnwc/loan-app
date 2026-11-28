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

  it("instead: when the client approves but a bank control (R29) still refers, it does not say the client decided", () => {
    render(
      <DecisionPanel
        decision={decision({
          outcome: "REFER",
          engineOutcome: "REFER",
          ruleResults: [
            {
              id: "RF-POLICY",
              name: "Standard terms (tenor in 6-month steps, amount at most 10 × monthly income)",
              kind: "REFERRAL",
              result: "FAIL",
              value: "32 months",
            },
          ],
          reasonCodes: [
            {
              code: "R29",
              staff:
                "Policy exception: the requested terms are outside the product's standard terms",
              borrower: "Your application needs a review by our credit team.",
            },
          ],
          referralTriggers: [
            "Policy exception: the requested terms are outside the product's standard terms",
          ],
          externalEngine: {
            role: "INSTEAD",
            outcome: "AUTO_APPROVE",
            reference: "EXT-4C2A9E61B7D0",
            agreed: null,
          },
        })}
      />,
    );
    expect(
      screen.getByText(
        "The client's decision engine (simulated) approved, instead of the score, but a bank control still refers it (see Referred because); the built-in score and grade are shown for pricing.",
      ),
    ).toBeInTheDocument();
    expect(screen.queryByText(/^Decided by the client's decision engine/)).toBeNull();
    expect(screen.getByText("Referred because:")).toBeInTheDocument();
  });

  it("instead: a client approval with no built-in grade (R26) says a person sets the terms, not a bank control", () => {
    render(
      <DecisionPanel
        decision={decision({
          outcome: "REFER",
          engineOutcome: "REFER",
          score: null,
          grade: null,
          monthlyRate: null,
          pd: null,
          recommendedAmount: null,
          ruleResults: [],
          reasonCodes: [
            {
              code: "R26",
              staff:
                "The external decision engine approved, but there is no built-in grade (not scored) to price the loan: a person sets the terms",
              borrower: "Your application needs a review by our credit team.",
            },
          ],
          externalEngine: {
            role: "INSTEAD",
            outcome: "AUTO_APPROVE",
            reference: "EXT-6D0A3E9C7B21",
            agreed: null,
          },
        })}
      />,
    );
    expect(
      screen.getByText(
        "The client's decision engine (simulated) approved, instead of the score, but there is no built-in grade to price the loan, so a person sets the terms (see Referred because).",
      ),
    ).toBeInTheDocument();
    expect(screen.queryByText(/bank control still refers it/)).toBeNull();
    expect(screen.queryByText(/score and grade are shown for pricing/)).toBeNull();
  });

  it("instead: a client decline turned into a referral by a bank-provider outage says a person decides", () => {
    render(
      <DecisionPanel
        decision={decision({
          outcome: "REFER",
          engineOutcome: "REFER",
          score: null,
          grade: null,
          ruleResults: [],
          externalEngine: {
            role: "INSTEAD",
            outcome: "AUTO_DECLINE",
            reference: "EXT-8B1D4F7A2C30",
            agreed: null,
          },
        })}
      />,
    );
    expect(
      screen.getByText(/declined, instead of the score, but a bank provider did not answer/),
    ).toBeInTheDocument();
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

  it("a failed knockout under shadow mode is not called a decline: a person decides it", () => {
    render(
      <DecisionPanel
        decision={decision({
          outcome: "REFER",
          engineOutcome: "AUTO_DECLINE",
          automationMode: "SHADOW",
          score: null,
          grade: null,
          ruleResults: [
            {
              id: "KO-SANCTIONS",
              name: "No sanctions or watchlist match",
              kind: "KNOCKOUT",
              result: "FAIL",
              value: "match",
            },
            {
              id: "EX-ENGINE",
              name: "External decision engine agrees with the built-in engine",
              kind: "REFERRAL",
              result: "NOT_EVALUATED",
              value: "auto-approve; ref EXT-1; a knockout declines whatever it says",
            },
          ],
          externalEngine: {
            role: "ALONGSIDE",
            outcome: "AUTO_APPROVE",
            reference: "EXT-1",
            agreed: null,
          },
        })}
      />,
    );
    expect(
      screen.getByText(
        "A knockout rule failed for this application; the client's decision engine (simulated) cannot overrule it.",
      ),
    ).toBeInTheDocument();
    expect(screen.queryByText(/knockout rule declined/)).toBeNull();
    expect(screen.getByText(/a person decides/)).toBeInTheDocument();
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
