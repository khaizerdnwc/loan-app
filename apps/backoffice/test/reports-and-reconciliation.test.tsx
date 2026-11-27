import type {
  DecisionMixReport,
  LatestReconciliationView,
  OriginationFunnelReport,
  ReconciliationRunView,
} from "@loan/core";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, vi } from "vitest";
import { ReconciliationPanel } from "@/components/operations/reconciliation-panel";
import { DecisionMixView, FunnelView } from "@/components/reports/report-views";
import { percent, periodQuery } from "@/lib/reports";

afterEach(() => vi.unstubAllGlobals());

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

describe("report helpers (RPT-1, RPT-2)", () => {
  it("percent turns a four-place share into words, without float drift", () => {
    expect(percent("0.6000")).toBe("60%");
    expect(percent("0.8333")).toBe("83.3%");
    expect(percent("1.0000")).toBe("100%");
    expect(percent("0.0000")).toBe("0%");
  });

  it("periodQuery asks for the last N Philippine business days, today included", () => {
    expect(periodQuery(30, new Date("2026-11-28T17:00:00.000Z"))).toBe(
      "?from=2026-10-31&to=2026-11-29",
    );
    expect(periodQuery(7, new Date("2026-11-28T03:00:00.000Z"))).toBe(
      "?from=2026-11-22&to=2026-11-28",
    );
  });
});

describe("DecisionMixView and FunnelView (RPT-1, RPT-2)", () => {
  const mix: DecisionMixReport = {
    period: { from: "2026-10-30", to: "2026-11-28" },
    decisions: 5,
    outcomes: [
      { key: "AUTO_APPROVE", count: 2, share: "0.4000" },
      { key: "REFER", count: 2, share: "0.4000" },
      { key: "AUTO_DECLINE", count: 1, share: "0.2000" },
    ],
    straightThroughRate: "0.6000",
    reasonCodes: [{ key: "R11", label: "Sanctions or watchlist match", count: 1, share: "0.2000" }],
    referralTriggers: [{ key: "Thin bureau file", count: 1, share: "0.5000" }],
    recommendations: 2,
    overrides: 1,
    overrideRate: "0.5000",
    overrideReasons: [{ key: "OV04", count: 1, share: "1.0000" }],
  };

  it("shows the straight-through and override rates and each mix in words", () => {
    render(<DecisionMixView report={mix} />);
    expect(screen.getByText("Straight-through rate").parentElement).toHaveTextContent("60%");
    expect(screen.getByText("Override rate").parentElement).toHaveTextContent(
      "50%1 of 2 recommendations",
    );
    const bars = within(screen.getByRole("list", { name: "Decision mix" })).getAllByRole(
      "listitem",
    );
    expect(bars.map((b) => b.textContent)).toEqual([
      "Auto-approve: 40% · 2",
      "Refer: 40% · 2",
      "Auto-decline: 20% · 1",
    ]);
    expect(screen.getByText("R11 · Sanctions or watchlist match")).toBeInTheDocument();
    expect(screen.getByText(/^OV04 · /)).toBeInTheDocument();
  });

  it("says so when a period has no decisions", () => {
    render(
      <DecisionMixView
        report={{
          ...mix,
          decisions: 0,
          outcomes: mix.outcomes.map((o) => ({ ...o, count: 0, share: "0.0000" })),
          reasonCodes: [],
          referralTriggers: [],
          overrideReasons: [],
        }}
      />,
    );
    expect(screen.getByText("No decisions in this period.")).toBeInTheDocument();
    expect(screen.getByText("No overrides in this period.")).toBeInTheDocument();
  });

  it("shows each funnel stage with its conversion and the disbursed amount through formatPeso", () => {
    const funnel: OriginationFunnelReport = {
      period: { from: "2026-10-30", to: "2026-11-28" },
      stages: [
        { key: "STARTED", count: 6, conversion: "1.0000" },
        { key: "SUBMITTED", count: 5, conversion: "0.8333" },
        { key: "APPROVED", count: 2, conversion: "0.4000" },
        { key: "DISBURSED", count: 1, conversion: "0.5000" },
      ],
      disbursedAmount: "60000.00",
      byStatus: [{ key: "APPROVAL", count: 2, share: "0.3333" }],
    };
    render(<FunnelView report={funnel} />);
    expect(screen.getByText("83.3% of started")).toBeInTheDocument();
    expect(screen.getByText("40% of submitted")).toBeInTheDocument();
    expect(screen.getByText("50% of approved · ₱60,000.00")).toBeInTheDocument();
    expect(
      within(screen.getByRole("list", { name: "Where they are now" })).getByRole("listitem"),
    ).toHaveTextContent("2 · 33.3%");
  });
});

describe("ReconciliationPanel (REC-2, REC-5, REC-6)", () => {
  const run: ReconciliationRunView = {
    id: "run-1",
    runAt: "2026-11-28T01:00:00.000Z",
    runByName: "Ella Reyes",
    providerMode: "SIMULATED",
    summary: {
      bookingRequests: 3,
      matched: 2,
      coreAccounts: 3,
      payments: 2,
      findings: 1,
      duplicates: 0,
      settledDuringRun: 0,
    },
    findings: [
      {
        kind: "CORE_ACCOUNT_UNDISBURSED",
        idempotencyKey: "bk-1",
        caseId: "case-1",
        caseReference: "APP-1001",
        coreAccountNumber: "LN-2026-001001",
        lendingAccountNumber: null,
        coreAmount: "60000.00",
        lendingAmount: null,
        detail: "Core holds open account LN-2026-001001; nothing was paid out.",
      },
    ],
  };

  it("loan operations runs it and sees the findings, in words, with the case and amounts", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(json({ run: null } satisfies LatestReconciliationView))
      .mockResolvedValueOnce(json(run, 201));
    vi.stubGlobal("fetch", fetchMock);
    const onRan = vi.fn();
    render(<ReconciliationPanel canRun onRan={onRan} />);
    expect(await screen.findByText(/No reconciliation has run yet/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Run reconciliation" }));

    expect(await screen.findByText("Open in core, not disbursed")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "APP-1001" })).toHaveAttribute("href", "/cases/case-1");
    expect(screen.getByText("Core: ₱60,000.00")).toBeInTheDocument();
    expect(screen.getByText("Lending: none")).toBeInTheDocument();
    expect(onRan).toHaveBeenCalledWith(run);
    const [url, init] = fetchMock.mock.calls[1] as [string, RequestInit];
    expect(url).toBe("/api/operations/reconciliation/runs");
    expect(init.method).toBe("POST");
  });

  it("Compliance reads the latest run but has no button to run one", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(json({ run })));
    render(<ReconciliationPanel canRun={false} />);
    expect(await screen.findByText(/Last run .* by Ella Reyes/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Run reconciliation" })).not.toBeInTheDocument();
    expect(screen.getByText("Loan operations runs the reconciliation.")).toBeInTheDocument();
  });

  it("a run over empty feeds says so in words, and bookings that settled during a run are explained", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValueOnce(
        json({
          run: {
            ...run,
            providerMode: "NO_RECORDS",
            findings: [],
            summary: { ...run.summary, findings: 0, settledDuringRun: 2 },
          },
        }),
      ),
    );
    render(<ReconciliationPanel canRun />);
    expect(await screen.findByText(/the feeds held no records/)).toBeInTheDocument();
    expect(screen.queryByText(/NO_RECORDS/)).not.toBeInTheDocument();
    expect(screen.getByText(/2 booking\(s\) completed during the run/)).toBeInTheDocument();
  });

  it("a feed that cannot answer is said in words, and the last run stays on screen", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(json({ run }))
        .mockResolvedValueOnce(
          json(
            {
              type: "about:blank",
              title: "Service Unavailable",
              status: 503,
              code: "PROVIDER_UNAVAILABLE",
              detail:
                "Core banking could not answer, so nothing was reconciled and no run was recorded. Try again once it is back.",
            },
            503,
          ),
        ),
    );
    render(<ReconciliationPanel canRun />);
    await userEvent.click(await screen.findByRole("button", { name: "Run reconciliation" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/nothing was reconciled/);
    expect(screen.getByText("Open in core, not disbursed")).toBeInTheDocument();
  });
});
