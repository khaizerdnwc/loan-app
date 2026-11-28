import type { CaseSummary, SlaView, TurnaroundReport } from "@loan/core";
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, vi } from "vitest";
import { QueueBody } from "@/components/queue-body";
import { TurnaroundView } from "@/components/reports/report-views";
import { businessDuration, CaseSla, calendarNote, SlaPill, SlaUnavailable } from "@/components/sla";

afterEach(() => vi.unstubAllGlobals());

const clock = (patch: Partial<SlaView> = {}): SlaView => ({
  caseId: "case-1",
  status: "REVIEW",
  enteredAt: "2026-12-01T01:00:00.000Z",
  targetMinutes: 480,
  elapsedMinutes: 100,
  remainingMinutes: 380,
  dueAt: "2026-12-01T09:00:00.000Z",
  state: "ON_TRACK",
  owner: "Loan officer",
  ...patch,
});

const summary = (id: string): CaseSummary =>
  ({
    id,
    reference: `APP-${id}`,
    applicantName: `Applicant ${id}`,
    productCode: "PL",
    requestedAmount: "100000.00",
    requestedTenorMonths: 12,
    status: "REVIEW",
    outcome: "REFER",
    reason: null,
    reasonCount: 0,
    grade: "C",
    escalated: false,
    createdAt: "2026-12-01T01:00:00.000Z",
    updatedAt: "2026-12-01T01:00:00.000Z",
  }) as CaseSummary;

describe("SLA display (SLA-1, SLA-2)", () => {
  it("business durations read as hours and minutes", () => {
    expect(businessDuration(380)).toBe("6h 20m");
    expect(businessDuration(120)).toBe("2h");
    expect(businessDuration(45)).toBe("45m");
    expect(businessDuration(-125)).toBe("2h 5m");
  });

  it("the pill says the state and the time left, or over", () => {
    const { rerender } = render(<SlaPill sla={clock()} />);
    expect(screen.getByText("On track · 6h 20m left")).toBeInTheDocument();
    rerender(<SlaPill sla={clock({ state: "AT_RISK", remainingMinutes: 90 })} />);
    expect(screen.getByText("At risk · 1h 30m left")).toBeInTheDocument();
    rerender(<SlaPill sla={clock({ state: "BREACHED", remainingMinutes: -125 })} />);
    expect(screen.getByText("Past SLA · 2h 5m over")).toBeInTheDocument();
  });

  it("the queue shows an SLA column and how many are past SLA or at risk", () => {
    const sla = new Map([
      ["1", clock({ caseId: "1", state: "BREACHED", remainingMinutes: -30 })],
      ["2", clock({ caseId: "2", state: "AT_RISK", remainingMinutes: 60 })],
    ]);
    render(
      <QueueBody
        staffRole="LOAN_OFFICER"
        items={[summary("1"), summary("2"), summary("3")]}
        stage="ALL"
        onStage={() => {}}
        empty="Empty"
        sla={sla}
      />,
    );
    expect(screen.getByText("Past SLA").parentElement).toHaveTextContent(
      "Past SLA11 at risk (2 business hours or less)",
    );
    expect(screen.getByRole("columnheader", { name: "SLA (business hours)" })).toBeInTheDocument();
    const rows = screen.getAllByRole("row").slice(1);
    expect(within(rows[0] as HTMLElement).getByText("Past SLA · 30m over")).toBeInTheDocument();
    expect(rows[2] as HTMLElement).toHaveTextContent("No SLA");
  });

  it("when the clocks cannot be read, the list says so in one line and stays complete", () => {
    render(<SlaUnavailable what="queue" />);
    const status = screen.getByRole("status");
    expect(status).toHaveTextContent(
      "SLA clocks could not be loaded just now. The queue is complete but shows no SLA. Reload to try again.",
    );
    // The shared callout, in the neutral tone (docs/ui-parity.md row 63).
    expect(status.querySelector("[data-tone]")).toHaveAttribute("data-tone", "neutral");
  });

  it("without clocks the queue has no SLA column or figure", () => {
    render(
      <QueueBody
        staffRole="LOAN_OFFICER"
        items={[summary("1")]}
        stage="ALL"
        onStage={() => {}}
        empty="Empty"
      />,
    );
    expect(
      screen.queryByRole("columnheader", { name: "SLA (business hours)" }),
    ).not.toBeInTheDocument();
    expect(screen.queryByText("Past SLA")).not.toBeInTheDocument();
  });

  it("the case page shows who acts next and by when, and nothing for a stage without a clock", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(new Response(JSON.stringify({ sla: clock() }), { status: 200 })),
    );
    const { unmount } = render(<CaseSla caseId="case-1" status="REVIEW" />);
    expect(await screen.findByText("On track · 6h 20m left")).toBeInTheDocument();
    expect(screen.getByText(/Loan officer · due .* \(business hours\)/)).toBeInTheDocument();
    unmount();

    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({ sla: null }), { status: 200 })),
    );
    const { container } = render(<CaseSla caseId="case-2" status="OFFER" />);
    await vi.waitFor(() => expect(fetch).toHaveBeenCalled());
    expect(container).toBeEmptyDOMElement();
  });

  it("the case page says the clock is unavailable when it cannot be read", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            type: "about:blank",
            title: "Unavailable",
            status: 503,
            code: "PROVIDER_UNAVAILABLE",
            detail: "Not answering.",
          }),
          { status: 503 },
        ),
      ),
    );
    render(<CaseSla caseId="case-3" status="REVIEW" />);
    expect(
      await screen.findByText(
        "SLA clock unavailable just now; the rest of the case is unaffected.",
      ),
    ).toBeInTheDocument();
  });

  it("past the holiday calendar's last date, the views say so", () => {
    expect(calendarNote("2027-06-12", "2027-06-12")).toBeNull();
    expect(calendarNote("2027-06-12", "2027-06-13")).toMatch(/holiday calendar ends .*2027/);
    expect(calendarNote(null, "2027-06-13")).toBe(
      "No holiday calendar is loaded: no holiday is skipped.",
    );
  });
});

describe("TurnaroundView (TAT-1)", () => {
  it("shows open cases by SLA state and business time per stage, with the holidays skipped", () => {
    const report: TurnaroundReport = {
      period: { from: "2026-11-01", to: "2026-11-30" },
      stages: [
        {
          status: "REVIEW",
          visits: 3,
          medianMinutes: 120,
          p90Minutes: 720,
          targetMinutes: 480,
          withinTarget: 2,
          withinTargetShare: "0.6667",
        },
        {
          status: "BOOKING",
          visits: 0,
          medianMinutes: null,
          p90Minutes: null,
          targetMinutes: 240,
          withinTarget: 0,
          withinTargetShare: null,
        },
      ],
      openNow: { onTrack: 4, atRisk: 1, breached: 2 },
      businessDay: { start: "09:00", end: "17:00" },
      holidays: [{ date: "2026-11-30", name: "Bonifacio Day" }],
      holidayCalendarEnds: "2027-06-12",
    };
    render(<TurnaroundView report={report} />);
    expect(screen.getByText("Open past SLA").parentElement).toHaveTextContent("2");
    const review = screen.getAllByRole("row")[1] as HTMLElement;
    expect(review).toHaveTextContent("3");
    expect(review).toHaveTextContent("2h");
    expect(review).toHaveTextContent("12h");
    expect(review).toHaveTextContent("8h");
    expect(review).toHaveTextContent("66.7%");
    expect(screen.getAllByRole("row")[2]).toHaveTextContent("—");
    expect(screen.getByText(/Holidays skipped: .*Bonifacio Day/)).toBeInTheDocument();
    expect(screen.getByText(/Monday to Friday, 09:00–17:00 Manila/)).toBeInTheDocument();
    expect(screen.queryByText(/holiday calendar/i)).not.toBeInTheDocument();
    cleanup();

    // No calendar loaded: the report says so instead of skipping nothing silently.
    render(<TurnaroundView report={{ ...report, holidays: [], holidayCalendarEnds: null }} />);
    expect(
      screen.getByText("No holiday calendar is loaded: no holiday is skipped."),
    ).toBeInTheDocument();
  });

  it("the case clock says so when no holiday calendar is loaded", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValueOnce(
        new Response(JSON.stringify({ sla: clock(), holidayCalendarEnds: null }), {
          status: 200,
        }),
      ),
    );
    render(<CaseSla caseId="case-4" status="REVIEW" />);
    expect(
      await screen.findByText("No holiday calendar is loaded: no holiday is skipped."),
    ).toBeInTheDocument();
  });
});
