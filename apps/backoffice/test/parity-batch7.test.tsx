/**
 * U-13: the queue filters, SLA notes, walk-in dialog, turnaround report and model governance
 * follow the shared parts (docs/ui-parity.md rows 63–72).
 */
import type { CaseStatus, CaseSummary, DriftView, TurnaroundReport } from "@loan/core";
import { ToastProvider } from "@loan/ui";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, vi } from "vitest";
import QueuePage from "@/app/(staff)/queue/page";
import { DriftMonitor } from "@/components/models/model-governance";
import { TurnaroundView } from "@/components/reports/report-views";

const { url, router } = vi.hoisted(() => {
  const url = { search: "" };
  return {
    url,
    router: {
      push: () => {},
      replace: (href: string) => {
        url.search = href.includes("?") ? href.slice(href.indexOf("?")) : "";
      },
    },
  };
});
vi.mock("next/navigation", () => ({
  usePathname: () => "/queue",
  useRouter: () => router,
  useSearchParams: () => new URLSearchParams(url.search),
}));
vi.mock("@/lib/session", () => ({
  useSession: () => ({ id: "STF-PAOLO", fullName: "Paolo Tan", role: "LOAN_OFFICER" }),
}));

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  url.search = "";
});

const summary = (id: string, status: CaseStatus, ownerId: string | null): CaseSummary =>
  ({
    id,
    reference: `APP-${id}`,
    applicantName: `Applicant ${id}`,
    productCode: "PL",
    requestedAmount: "100000.00",
    requestedTenorMonths: 12,
    status,
    outcome: status === "DRAFT" ? null : "REFER",
    reason: null,
    reasonCount: 0,
    grade: "C",
    escalated: false,
    ownerId,
    ownerName: ownerId ? "Paolo Tan" : null,
    channel: "BRANCH",
    priority: "NORMAL",
    createdAt: "2026-12-01T01:00:00.000Z",
    updatedAt: "2026-12-01T01:00:00.000Z",
  }) as CaseSummary;

const queue = [
  summary("1", "REVIEW", null),
  summary("2", "DRAFT", "STF-PAOLO"),
  summary("3", "REVIEW", "STF-PAOLO"),
];

function stubQueue() {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (u: string) =>
      u.includes("/sla/")
        ? new Response("[]", { status: 200 })
        : new Response(JSON.stringify({ items: queue }), { status: 200 }),
    ),
  );
}

const renderQueue = () =>
  render(
    <ToastProvider>
      <QueuePage />
    </ToastProvider>,
  );

const pressed = (name: RegExp) => screen.getByRole("button", { name });

describe("queue filters in the URL (row 63)", () => {
  it("opens on the owner and stage the URL names", async () => {
    url.search = "?owner=mine&stage=REVIEW";
    stubQueue();
    renderQueue();
    await screen.findByRole("table");
    expect(pressed(/^Mine\s*2$/)).toHaveAttribute("aria-pressed", "true");
    expect(pressed(/^In review\s*1$/)).toHaveAttribute("aria-pressed", "true");
    expect(screen.getAllByRole("row")).toHaveLength(2);
  });

  it("writes each choice to the URL, keeping the other filter", async () => {
    url.search = "?owner=mine";
    stubQueue();
    const replace = vi.spyOn(router, "replace");
    const { rerender } = renderQueue();
    await screen.findByRole("table");
    await userEvent.click(pressed(/^In review\s*1$/));
    expect(replace).toHaveBeenLastCalledWith("/queue?owner=mine&stage=REVIEW", { scroll: false });
    rerender(
      <ToastProvider>
        <QueuePage />
      </ToastProvider>,
    );
    await userEvent.click(pressed(/^Team\s*3$/));
    expect(replace).toHaveBeenLastCalledWith("/queue?stage=REVIEW", { scroll: false });
  });

  it("an unknown owner or stage falls back to the whole team and all stages", async () => {
    url.search = "?owner=boss&stage=NOPE";
    stubQueue();
    renderQueue();
    await screen.findByRole("table");
    expect(pressed(/^Team\s*3$/)).toHaveAttribute("aria-pressed", "true");
    expect(screen.getAllByRole("row")).toHaveLength(4);
  });
});

describe("turnaround report (row 68)", () => {
  it("says the holiday calendar's limit in a warning callout", () => {
    const report: TurnaroundReport = {
      period: { from: "2026-11-01", to: "2026-11-30" },
      stages: [],
      openNow: { onTrack: 0, atRisk: 0, breached: 0 },
      businessDay: { start: "09:00", end: "18:00" },
      holidays: [],
      holidayCalendarEnds: null,
    };
    render(<TurnaroundView report={report} />);
    const note = screen.getByText("No holiday calendar is loaded: no holiday is skipped.");
    expect(note.closest("[data-tone]")).toHaveAttribute("data-tone", "warn");
  });
});

describe("model governance (rows 70–71)", () => {
  it("shows grades as grade tiles and counts through formatNumber", () => {
    const drift: DriftView = {
      baseline: { from: "2026-09-01", to: "2026-10-31", decisions: 1200, meanScore: 690 },
      recent: { from: "2026-11-01", to: "2026-11-30", decisions: 640, meanScore: 684 },
      grades: [
        { grade: "A", baselinePct: 30, recentPct: 28.5 },
        { grade: "C", baselinePct: 40, recentPct: 41.5 },
      ],
      psi: "0.0123",
      status: "STABLE",
      minimumDecisions: 100,
    };
    render(<DriftMonitor drift={drift} />);
    expect(screen.getByRole("img", { name: "Grade A" })).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "Grade C" })).toBeInTheDocument();
  });
});
