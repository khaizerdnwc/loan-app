import type { DriftView, ModelRegistryView, OverrideMonitorView } from "@loan/core";
import { render, screen, within } from "@testing-library/react";
import { DriftMonitor, ModelRegistry, OverrideMonitor } from "@/components/models/model-governance";

const registry: ModelRegistryView = {
  scorecards: [
    {
      version: "SC-A",
      current: false,
      features: ["bureau.bureauScore"],
      prohibitedFeatures: [],
      hasPd: false,
      decisions: 12,
      firstUsedAt: "2026-11-01T00:00:00.000Z",
      lastUsedAt: "2026-11-20T00:00:00.000Z",
    },
    {
      version: "SC-B",
      current: true,
      features: ["bureau.bureauScore", "applicant.employmentMonths"],
      prohibitedFeatures: [],
      hasPd: true,
      decisions: 3,
      firstUsedAt: "2026-11-27T00:00:00.000Z",
      lastUsedAt: "2026-11-28T00:00:00.000Z",
    },
  ],
  ruleSets: [
    { version: "RS-X", current: true, decisions: 15, firstUsedAt: null, lastUsedAt: null },
  ],
  prohibitedFeatures: ["applicant.gender", "applicant.ageYears"],
};

describe("Model governance screens (MG-2..MG-4)", () => {
  it("the registry shows each version, the current one, its use and a passing check", () => {
    render(<ModelRegistry registry={registry} />);
    const table = screen.getByRole("table", {
      name: "Scorecards, their use and the prohibited-features check",
    });
    const current = within(table).getByText("SC-B").closest("tr") as HTMLElement;
    expect(within(current).getByText("Current")).toBeInTheDocument();
    expect(within(current).getByText("None used")).toBeInTheDocument();
    expect(screen.getByText(/No score may use:/).parentElement).toHaveTextContent("Gender, Age");
    expect(screen.getByText(/The current scorecard reads:/).parentElement).toHaveTextContent(
      "Bureau score, Time in employment",
    );
  });

  it("a scorecard that uses a prohibited attribute is flagged", () => {
    render(
      <ModelRegistry
        registry={{
          ...registry,
          scorecards: [
            {
              ...(registry.scorecards[0] as ModelRegistryView["scorecards"][number]),
              prohibitedFeatures: ["applicant.gender"],
            },
          ],
        }}
      />,
    );
    expect(screen.getByText("Uses Gender")).toBeInTheDocument();
  });

  it("overrides: the rate, the reasons in words and not-live agreement", () => {
    const monitor: OverrideMonitorView = {
      since: "2026-10-29T00:00:00.000Z",
      recommendations: 8,
      overrides: 2,
      byReason: [{ code: "OV04", count: 2 }],
      matrix: [{ engineOutcome: "REFER", recommendation: "COUNTER_OFFER", count: 2 }],
      notLive: { compared: 4, agreed: 3 },
    };
    render(<OverrideMonitor monitor={monitor} />);
    expect(screen.getByText("25.0%")).toBeInTheDocument();
    expect(screen.getByText("75.0%")).toBeInTheDocument();
    expect(screen.getByRole("list", { name: "Overrides by reason code" })).toHaveTextContent(
      "OV04 · Lower amount or shorter tenor reduces exposure",
    );
    expect(screen.getByText("Counter-offer")).toBeInTheDocument();
  });

  it("no recommendations yet says so", () => {
    render(
      <OverrideMonitor
        monitor={{
          since: "2026-10-29T00:00:00.000Z",
          recommendations: 0,
          overrides: 0,
          byReason: [],
          matrix: [],
          notLive: { compared: 0, agreed: 0 },
        }}
      />,
    );
    expect(screen.getByText("No recommendations in this window")).toBeInTheDocument();
  });

  it("drift on too little data shows no PSI figure and says how many decisions each window has", () => {
    render(
      <DriftMonitor
        drift={{
          baseline: {
            from: "2026-07-31T00:00:00.000Z",
            to: "2026-10-29T00:00:00.000Z",
            decisions: 12,
            meanScore: 700,
          },
          recent: {
            from: "2026-10-29T00:00:00.000Z",
            to: "2026-11-28T00:00:00.000Z",
            decisions: 4,
            meanScore: 650,
          },
          grades: [{ grade: "A", baselinePct: 50, recentPct: 25 }],
          psi: null,
          status: "INSUFFICIENT_DATA",
          minimumDecisions: 30,
        }}
      />,
    );
    expect(screen.getByText("Not enough decisions")).toBeInTheDocument();
    expect(
      screen.getByText(
        /PSI not computed: baseline 12, recent 4 of the 30 scored decisions needed per window/,
      ),
    ).toBeInTheDocument();
    expect(screen.queryByText(/Population stability index/)).toBeNull();
  });

  it("drift: the status in words, the PSI and the grade shares", () => {
    const drift: DriftView = {
      baseline: {
        from: "2026-07-31T00:00:00.000Z",
        to: "2026-10-29T00:00:00.000Z",
        decisions: 100,
        meanScore: 690.5,
      },
      recent: {
        from: "2026-10-29T00:00:00.000Z",
        to: "2026-11-28T00:00:00.000Z",
        decisions: 100,
        meanScore: 650,
      },
      grades: [
        { grade: "A", baselinePct: 35, recentPct: 20 },
        { grade: "B", baselinePct: 30, recentPct: 30 },
        { grade: "C", baselinePct: 20, recentPct: 25 },
        { grade: "D", baselinePct: 10, recentPct: 15 },
        { grade: "E", baselinePct: 5, recentPct: 10 },
      ],
      psi: "0.1500",
      status: "MODERATE",
      minimumDecisions: 30,
    };
    render(<DriftMonitor drift={drift} />);
    expect(screen.getByText("Moderate shift")).toBeInTheDocument();
    expect(screen.getByText(/Population stability index 0.1500/)).toBeInTheDocument();
    const row = within(
      screen.getByRole("table", {
        name: "Share of scored decisions per grade, baseline against recent",
      }),
    )
      .getByText("A")
      .closest("tr") as HTMLElement;
    expect(row).toHaveTextContent("35.0%");
    expect(row).toHaveTextContent("20.0%");
  });
});
