/**
 * U-12: the operations, reports, provider and decision-estimate screens follow the shared parts
 * (docs/ui-parity.md rows 53–62).
 */
import type {
  BookingExceptionView,
  DecisionRecordView,
  LatestReconciliationView,
  ReconciliationRunView,
} from "@loan/core";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, vi } from "vitest";
import BookingExceptionsPage from "@/app/(staff)/operations/exceptions/page";
import { DecisionPanel } from "@/components/case/decision-panel";
import { ReportPage } from "@/components/reports/report-page";
import { DecisionMixView } from "@/components/reports/report-views";

const { url, router, location } = vi.hoisted(() => {
  const url = { search: "" };
  const location = { pathname: "/reports/decisions" };
  return {
    url,
    location,
    router: {
      push: () => {},
      replace: (href: string) => {
        url.search = href.includes("?") ? href.slice(href.indexOf("?")) : "";
      },
    },
  };
});
vi.mock("next/navigation", () => ({
  usePathname: () => location.pathname,
  useRouter: () => router,
  useSearchParams: () => new URLSearchParams(url.search),
}));
vi.mock("@/lib/session", () => ({
  useSession: () => ({
    id: "STF-ELLA",
    fullName: "Ella Reyes",
    role: "LOAN_OPERATIONS_SUPERVISOR",
  }),
}));

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  url.search = "";
});

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

describe("report period in the URL (row 57)", () => {
  it("opens on 30 days, asks the API for the period the URL names, and rewrites the URL on change", async () => {
    url.search = "?days=7";
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => json({ ok: true }));
    vi.stubGlobal("fetch", fetchMock);
    const replace = vi.spyOn(router, "replace");
    const { rerender } = render(
      <ReportPage<{ ok: boolean }>
        title="Decisioning"
        description="x"
        path="/reports/decision-mix"
        render={() => <p>Report body</p>}
      />,
    );
    await screen.findByText("Report body");
    expect(screen.getByRole("button", { name: "7 days" })).toHaveAttribute("aria-pressed", "true");
    const first = String(fetchMock.mock.calls[0]?.[0]);
    expect(first).toMatch(/^\/api\/reports\/decision-mix\?from=/);
    // The request covers exactly 7 days, today included.
    expect(spanOf(first)).toBe(7);

    await userEvent.click(screen.getByRole("button", { name: "90 days" }));
    expect(replace).toHaveBeenLastCalledWith("/reports/decisions?days=90", { scroll: false });
    rerender(
      <ReportPage<{ ok: boolean }>
        title="Decisioning"
        description="x"
        path="/reports/decision-mix"
        render={() => <p>Report body</p>}
      />,
    );
    expect(screen.getByRole("button", { name: "90 days" })).toHaveAttribute("aria-pressed", "true");
    // The new period is what the API is asked for: 90 days, a different start.
    const last = String(fetchMock.mock.calls.at(-1)?.[0]);
    expect(spanOf(last)).toBe(90);
    expect(new URLSearchParams(last.split("?")[1]).get("from")).not.toBe(
      new URLSearchParams(first.split("?")[1]).get("from"),
    );
    await userEvent.click(screen.getByRole("button", { name: "30 days" }));
    expect(replace).toHaveBeenLastCalledWith("/reports/decisions", { scroll: false });
  });

  it("an unknown ?days falls back to 30 days", async () => {
    url.search = "?days=abc";
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => json({ ok: true }));
    vi.stubGlobal("fetch", fetchMock);
    render(
      <ReportPage<{ ok: boolean }>
        title="Decisioning"
        description="x"
        path="/reports/decision-mix"
        render={() => <p>Report body</p>}
      />,
    );
    await screen.findByText("Report body");
    expect(screen.getByRole("button", { name: "30 days" })).toHaveAttribute("aria-pressed", "true");
    expect(spanOf(String(fetchMock.mock.calls[0]?.[0]))).toBe(30);
  });

  it.each([
    ["7 days", "2026-11-22", true],
    ["30 days", "2026-10-30", true],
    ["90 days", "2026-08-31", false],
  ])(
    "a %s period with no data uses the shared empty state; the hint to widen it shows only when a longer period exists",
    (_name, from, hinted) => {
      render(
        <DecisionMixView
          report={{
            period: { from, to: "2026-11-28" },
            decisions: 0,
            outcomes: [],
            straightThroughRate: "0.0000",
            reasonCodes: [],
            referralTriggers: [],
            recommendations: 0,
            overrides: 0,
            overrideRate: "0.0000",
            overrideReasons: [],
          }}
        />,
      );
      const empty = screen.getByText("No decisions in this period.");
      expect(empty.className).toMatch(/font-bold/);
      expect(screen.queryAllByText("Choose a longer period to see more.").length > 0).toBe(hinted);
    },
  );
});

/** The number of days a report request covers, both ends included. */
function spanOf(request: string): number {
  const q = new URLSearchParams(request.split("?")[1]);
  const from = q.get("from") ?? "";
  const to = q.get("to") ?? "";
  return Math.round((Date.parse(to) - Date.parse(from)) / 86_400_000) + 1;
}

describe("booking exceptions and reconciliation (rows 53–55)", () => {
  const exception = {
    caseId: "case-1",
    caseReference: "APP-1001",
    applicantName: "Maria Santos",
    amount: "150000.00",
    status: "BOOKING_FAILED",
    lastError: "Core banking did not confirm ₱150000.00 in time.",
    lastAttemptAt: "2026-11-28T01:00:00.000Z",
    idempotencyKey: "bk-1",
    attempts: 2,
    blockedReason: "Held for Compliance: ₱150000.00 matched a watchlist.",
    reconciliation: null,
  } as unknown as BookingExceptionView;

  const run = {
    id: "run-1",
    runAt: "2026-11-28T01:00:00.000Z",
    runByName: "Ella Reyes",
    providerMode: "SIMULATED",
    summary: {
      bookingRequests: 2,
      matched: 1,
      coreAccounts: 2,
      payments: 1,
      findings: 2,
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
        detail: "Core holds open account LN-2026-001001 for ₱60000.00; nothing was paid out.",
      },
      {
        kind: "PAYMENT_WITHOUT_BOOKING",
        idempotencyKey: "bk-9",
        caseId: null,
        caseReference: null,
        coreAccountNumber: null,
        lendingAccountNumber: null,
        coreAmount: null,
        lendingAmount: null,
        detail: "The rail paid out with no booking in lending.",
      },
    ],
  } as unknown as ReconciliationRunView;

  it("formats the amounts in the API's sentences, and only findings about a case open it from their row", async () => {
    location.pathname = "/operations/exceptions";
    vi.stubGlobal(
      "fetch",
      vi.fn(async (u: string) =>
        u.includes("/reconciliation/latest")
          ? json({ run } satisfies LatestReconciliationView)
          : json([exception]),
      ),
    );
    render(<BookingExceptionsPage />);
    expect(
      await screen.findByText("Core banking did not confirm ₱150,000.00 in time."),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Held for Compliance: ₱150,000.00 matched a watchlist."),
    ).toBeInTheDocument();
    expect(
      await screen.findByText(
        "Core holds open account LN-2026-001001 for ₱60,000.00; nothing was paid out.",
      ),
    ).toBeInTheDocument();

    const findings = screen.getByRole("table", { name: "Reconciliation findings" });
    const [, withCase, without] = within(findings).getAllByRole("row") as HTMLElement[];
    expect(withCase).toHaveAttribute("data-clickable", "true");
    expect(within(withCase as HTMLElement).getByRole("link", { name: "APP-1001" })).toHaveAttribute(
      "data-row-link",
    );
    expect(without).not.toHaveAttribute("data-clickable");
  });
});

describe("decision estimates as the shared facts block (row 60)", () => {
  it("shows debt-to-income, rate, PD, affordable amount and latency as label-over-value facts", () => {
    render(
      <DecisionPanel
        decision={
          {
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
          } as unknown as DecisionRecordView
        }
      />,
    );
    for (const label of [
      "Debt-to-income",
      "Rate for grade",
      "Probability of default, grade C (12 months)",
      "Affordable amount (engine)",
      "Decided in",
    ]) {
      const dt = screen.getByText(label);
      expect(dt.tagName).toBe("DT");
      expect(dt.className).toMatch(/uppercase/);
    }
    expect(screen.getByText("Debt-to-income").parentElement).toHaveTextContent("43.0%");
  });
});
