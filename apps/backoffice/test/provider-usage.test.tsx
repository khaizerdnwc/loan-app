import type { DecisionLatencyView, DecisionRecordView, ProviderUsageView } from "@loan/core";
import { render, screen, within } from "@testing-library/react";
import { afterEach, vi } from "vitest";
import { DecisionPanel } from "@/components/case/decision-panel";
import { ProviderUsage } from "@/components/provider-usage";

afterEach(() => vi.unstubAllGlobals());

const usage: ProviderUsageView = {
  since: "2026-10-29T00:00:00.000Z",
  totalCost: "1240.00",
  services: [
    {
      service: "CREDIT_BUREAU",
      attempts: 40,
      ok: 34,
      failed: 6,
      shortCircuited: 2,
      cacheHits: 5,
      cost: "850.00",
      circuit: { state: "OPEN", consecutiveFailures: 5, openUntil: "2026-11-28T02:00:30.000Z" },
    },
    {
      service: "KYC_AML",
      attempts: 39,
      ok: 39,
      failed: 0,
      shortCircuited: 0,
      cacheHits: 0,
      cost: "390.00",
      circuit: { state: "CLOSED", consecutiveFailures: 0, openUntil: null },
    },
  ],
};

const latency: DecisionLatencyView = {
  since: "2026-10-29T00:00:00.000Z",
  decisions: 39,
  p50Ms: 420,
  p95Ms: 1850,
  maxMs: 9600,
  targetP95Ms: 60_000,
};

function stubApi() {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      const body = url.includes("/providers/usage") ? usage : latency;
      return new Response(JSON.stringify(body), { status: 200 });
    }),
  );
}

describe("ProviderUsage (PR-4, PR-5)", () => {
  it("shows calls, failures, skipped and reused calls, cost and each circuit, labelled simulated", async () => {
    stubApi();
    render(<ProviderUsage />);
    const table = await screen.findByRole("table", {
      name: "Decision provider calls, failures, reuse and cost",
    });
    const bureau = within(table).getByText("Credit bureau").closest("tr") as HTMLElement;
    expect(bureau).toHaveTextContent("40");
    expect(bureau).toHaveTextContent("₱850.00");
    expect(within(bureau).getByText("Paused · applications referred")).toBeInTheDocument();
    expect(within(bureau).getByText(/Calls resume after/)).toBeInTheDocument();
    expect(screen.getByText("Calling")).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "Skipped (paused)" })).toBeInTheDocument();
    expect(screen.getByText("₱1,240.00")).toBeInTheDocument();
    expect(screen.getByText(/Simulated · prices/)).toBeInTheDocument();
  });

  it("shows latency percentiles against the 60-second target", async () => {
    stubApi();
    render(<ProviderUsage />);
    expect(await screen.findByText("1.9 s")).toBeInTheDocument();
    expect(screen.getByText("60.0 s")).toBeInTheDocument();
    expect(screen.getByText("0.4 s")).toBeInTheDocument();
    expect(screen.getByText("Within target")).toBeInTheDocument();
    expect(screen.getByText(/Simulated · providers/)).toBeInTheDocument();
    // The shared facts block: each figure under its label (docs/ui-parity.md row 59).
    expect(screen.getByText("Median").tagName).toBe("DT");
    expect(screen.getByText("Median").parentElement).toHaveTextContent(/^Median\s*0\.4 s$/);
    expect(screen.getByText("95th percentile").parentElement).toHaveTextContent(
      /^95th percentile\s*1\.9 s$/,
    );
    expect(screen.getByText("Decisions measured").parentElement).toHaveTextContent(
      /^Decisions measured\s*39$/,
    );
  });

  it("with no decision in the window, says so in the shared empty state, with no figures", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        const body = url.includes("/providers/usage")
          ? usage
          : { ...latency, decisions: 0, p50Ms: null, p95Ms: null, maxMs: null };
        return new Response(JSON.stringify(body), { status: 200 });
      }),
    );
    render(<ProviderUsage />);
    const title = await screen.findByText("No decisions measured yet");
    expect(title.className).toMatch(/font-bold/);
    expect(screen.getByText("Decisions made in the last 30 days appear here.")).toBeInTheDocument();
    expect(screen.queryByText("Median")).toBeNull();
    expect(screen.queryByText("Within target")).toBeNull();
  });

  it("says when the 95th percentile is over the target", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        const body = url.includes("/providers/usage")
          ? usage
          : { ...latency, p95Ms: 61_000, maxMs: 70_000 };
        return new Response(JSON.stringify(body), { status: 200 });
      }),
    );
    render(<ProviderUsage />);
    expect(await screen.findByText("Over target")).toBeInTheDocument();
  });
});

describe("DecisionPanel estimates (D-16)", () => {
  const decision = {
    id: "d1",
    caseId: "case-1",
    outcome: "REFER",
    engineOutcome: "REFER",
    automationMode: "LIVE",
    killSwitch: false,
    score: 602,
    grade: "C",
    ruleSetVersion: "RS-PL-3",
    scorecardVersion: "SC-PL-2",
    ruleResults: [],
    scoreContributions: [],
    reasonCodes: [],
    referralTriggers: [],
    debtToIncome: "0.4300",
    monthlyRate: "0.0160",
    providerMode: "SIMULATED",
    inputs: {},
    inputsHash: "h",
    createdAt: "2026-11-28T01:00:00.000Z",
    pd: "0.0300",
    recommendedAmount: "84000.00",
    latencyMs: 1234,
  } as unknown as DecisionRecordView;

  it("shows the grade's PD, the engine's affordable amount with its basis, and the latency", () => {
    render(<DecisionPanel decision={decision} />);
    expect(
      screen.getByText("Probability of default, grade C (12 months)").nextSibling,
    ).toHaveTextContent("3.0%");
    expect(screen.getByText("Affordable amount (engine)").nextSibling).toHaveTextContent(
      "₱84,000.00",
    );
    expect(
      screen.getByText(/indicative.*debt-service limit of RS-PL-3.*Not an offer/),
    ).toBeInTheDocument();
    expect(screen.queryByText(/Recommended amount/)).toBeNull();
    expect(screen.getByText("Decided in").nextSibling).toHaveTextContent("1.2 s");
  });

  it("nothing affordable is said in words, never as ₱0.00", () => {
    render(<DecisionPanel decision={{ ...decision, recommendedAmount: "0.00" }} />);
    expect(screen.getByText("Affordable amount (engine)").nextSibling).toHaveTextContent("None");
    expect(
      screen.getByText(
        "Nothing is affordable at this grade's rate within the debt-service limit of RS-PL-3.",
      ),
    ).toBeInTheDocument();
    expect(screen.queryByText(/₱0\.00/)).toBeNull();
  });

  it("an older record without estimates shows neither", () => {
    render(
      <DecisionPanel
        decision={{ ...decision, pd: null, recommendedAmount: null, latencyMs: null }}
      />,
    );
    expect(screen.queryByText("Affordable amount (engine)")).toBeNull();
    expect(screen.queryByText(/Probability of default/)).toBeNull();
    expect(screen.queryByText("Decided in")).toBeNull();
  });
});
