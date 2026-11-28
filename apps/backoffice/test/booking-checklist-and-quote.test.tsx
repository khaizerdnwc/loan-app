import type { BookingCheckView, IndicativeRepaymentView } from "@loan/core";
import { act, render, renderHook, screen, waitFor, within } from "@testing-library/react";
import { afterEach, vi } from "vitest";
import { ApprovedTermsNote } from "@/components/case/approved-terms-note";
import { BookingChecklistPanel } from "@/components/case/booking-checklist-panel";
import { IndicativeRepayment } from "@/components/case/indicative-repayment";
import { indicativeQuotePath, useIndicativeRepayment } from "@/lib/use-indicative-repayment";

const ITEMS: BookingCheckView[] = [
  {
    check: "APPROVALS_COMPLETE",
    label: "Approvals complete",
    passed: true,
    detail: "₱60000.00 over 12 months, approved automatically",
  },
  {
    check: "DOCUMENTS_SIGNED",
    label: "Documents signed",
    passed: true,
    detail: "Loan agreement e-signed by the borrower (envelope ENV-1, simulated)",
  },
  { check: "KYC_VALID", label: "KYC valid", passed: true, detail: "Identity verified" },
  {
    check: "DISBURSEMENT_ACCOUNT_VERIFIED",
    label: "Disbursement account verified",
    passed: false,
    detail: "No valid WhiteBank deposit account on record for the applicant",
  },
];

describe("BookingChecklistPanel (BK-1)", () => {
  it("lists every item with its verdict and says how many pass", () => {
    render(<BookingChecklistPanel items={ITEMS} />);
    const list = screen.getByRole("list", { name: "Pre-booking checklist" });
    const rows = within(list).getAllByRole("listitem");
    expect(rows).toHaveLength(4);
    expect(rows[0]).toHaveTextContent("Approvals complete — passes");
    expect(rows[3]).toHaveTextContent(
      "Disbursement account verified — failsNo valid WhiteBank deposit account",
    );
    expect(screen.getByText("3 of 4 pass")).toBeInTheDocument();
    // The API's sentence keeps its amount ungrouped; the screen groups it (formatAmountsInText).
    expect(rows[0]).toHaveTextContent("₱60,000.00 over 12 months, approved automatically");
  });

  it("says so when every item passes", () => {
    render(<BookingChecklistPanel items={ITEMS.map((i) => ({ ...i, passed: true }))} />);
    expect(screen.getByText("Every item passes")).toBeInTheDocument();
  });
});

const QUOTED: IndicativeRepaymentView = {
  status: "QUOTED",
  amount: "150000.00",
  tenorMonths: 24,
  grade: "C",
  monthlyRate: "0.0160",
  regularInstalment: "8650.00",
  finalInstalment: "8650.00",
  totalRepayable: "207600.00",
  providerMode: "SIMULATED",
};

describe("IndicativeRepayment (IR-1, PRD INT-004)", () => {
  it("shows core's quote through formatPeso, labelled indicative, grade C and simulated", () => {
    render(<IndicativeRepayment quote={QUOTED} />);
    const box = screen.getByTestId("indicative-repayment");
    expect(box).toHaveTextContent("Indicative monthly repayment₱8,650.00");
    expect(box).toHaveTextContent("At grade C pricing (1.60% / month) · calculated by core");
    expect(box).toHaveTextContent("Indicative only, not an offer");
    expect(box).toHaveTextContent("Simulated · core banking");
  });

  it("says unavailable when core cannot quote, and that nothing else depends on it", () => {
    render(
      <IndicativeRepayment
        quote={{
          ...QUOTED,
          status: "UNAVAILABLE",
          regularInstalment: null,
          finalInstalment: null,
          totalRepayable: null,
          providerMode: null,
        }}
      />,
    );
    const box = screen.getByTestId("indicative-repayment");
    expect(box).toHaveTextContent("Indicative monthly repaymentUnavailable");
    expect(box).toHaveTextContent("does not affect saving or submitting");
    expect(box).not.toHaveTextContent("₱");
  });

  it("waits for valid terms, and says when it is calculating", () => {
    const { rerender } = render(<IndicativeRepayment quote={null} />);
    expect(screen.getByTestId("indicative-repayment")).toHaveTextContent(
      "Shown once the amount and tenor are valid",
    );
    rerender(<IndicativeRepayment quote={null} loading />);
    expect(screen.getByTestId("indicative-repayment")).toHaveTextContent("Calculating…");
  });

  it("announces only the value, not the whole box", () => {
    render(<IndicativeRepayment quote={QUOTED} />);
    expect(screen.getByTestId("indicative-repayment")).not.toHaveAttribute("aria-live");
    const value = screen.getByTestId("indicative-value");
    expect(value).toHaveAttribute("aria-live", "polite");
    expect(value).toHaveTextContent(/^₱8,650\.00$/);
  });

  it("shows a failure that is not core's in the API client's words, without blaming core", () => {
    render(<IndicativeRepayment quote={null} error="Your session has ended. Sign in again." />);
    const box = screen.getByTestId("indicative-repayment");
    expect(box).toHaveTextContent("Unavailable");
    expect(box).toHaveTextContent("Your session has ended. Sign in again.");
    expect(box).not.toHaveTextContent("could not quote");
    expect(box).not.toHaveTextContent("does not affect saving or submitting");
  });
});

describe("ApprovedTermsNote (IR-1, lesson unavailable-says-why)", () => {
  const approved = {
    by: null,
    amount: "150000.00",
    tenorMonths: 24,
    monthlyRate: "0.0120",
    regularInstalment: "8050.00",
  };

  it("credits core banking when it quoted the instalment", () => {
    render(<ApprovedTermsNote approved={approved} />);
    expect(
      screen.getByText("Approved automatically · instalment quoted by core banking (simulated)"),
    ).toBeInTheDocument();
  });

  it("says core could not quote it, when it is asked again, and that booking is unaffected", () => {
    render(<ApprovedTermsNote approved={{ ...approved, regularInstalment: null }} />);
    const note = screen.getByText(/could not quote the monthly instalment just now/);
    expect(note).toHaveTextContent("Core banking (simulated)");
    expect(note).toHaveTextContent("asked again each time this case is opened");
    expect(note).toHaveTextContent("booking takes the full schedule from core");
    expect(note).not.toHaveTextContent("instalment quoted by core banking");
  });
});

describe("useIndicativeRepayment", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  const ok = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });

  it("waits for the officer to pause, then asks once for the latest terms", async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn().mockResolvedValue(ok(QUOTED));
    vi.stubGlobal("fetch", fetchMock);
    const { result, rerender } = renderHook(
      ({ amount }) => useIndicativeRepayment(amount, "24", 400),
      { initialProps: { amount: "150000" } },
    );
    expect(result.current).toEqual({ quote: null, loading: true, error: null });
    await act(() => vi.advanceTimersByTimeAsync(200));
    rerender({ amount: "150000.00" });
    rerender({ amount: "160000" });
    await act(() => vi.advanceTimersByTimeAsync(399));
    expect(fetchMock).not.toHaveBeenCalled();
    await act(() => vi.advanceTimersByTimeAsync(1));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      "/api/products/PL/quote?amount=160000.00&tenorMonths=24",
    );
  });

  it("drops a reply for terms that have since changed", async () => {
    vi.useFakeTimers();
    let answerFirst: (r: Response) => void = () => {};
    const fetchMock = vi
      .fn()
      .mockImplementationOnce(() => new Promise<Response>((r) => (answerFirst = r)))
      .mockResolvedValueOnce(ok({ ...QUOTED, amount: "160000.00", regularInstalment: "9226.66" }));
    vi.stubGlobal("fetch", fetchMock);
    const { result, rerender } = renderHook(
      ({ amount }) => useIndicativeRepayment(amount, "24", 10),
      { initialProps: { amount: "150000" } },
    );
    await act(() => vi.advanceTimersByTimeAsync(10));
    rerender({ amount: "160000" });
    await act(() => vi.advanceTimersByTimeAsync(10));
    await act(async () => answerFirst(ok(QUOTED)));
    expect(result.current.quote?.regularInstalment).toBe("9226.66");
  });

  it("turns a failed request into the API client's message, and core's 503 into its own", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("offline")));
    const offline = renderHook(() => useIndicativeRepayment("150000", "24", 0));
    await waitFor(() => expect(offline.result.current.loading).toBe(false));
    expect(offline.result.current).toEqual({
      quote: null,
      loading: false,
      error: "You appear to be offline. Check your connection and try again.",
    });

    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ status: 503, code: "PROVIDER_UNAVAILABLE", detail: "x" }), {
          status: 503,
        }),
      ),
    );
    const down = renderHook(() => useIndicativeRepayment("150000", "24", 0));
    await waitFor(() => expect(down.result.current.loading).toBe(false));
    expect(down.result.current.error).toBe(
      "Core banking (simulated) is not answering. This does not affect saving or submitting the application.",
    );
  });

  it("asks nothing while the terms are invalid", () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const { result } = renderHook(() => useIndicativeRepayment("100", "24", 0));
    expect(result.current).toEqual({ quote: null, loading: false, error: null });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("indicativeQuotePath", () => {
  it("asks only for terms the form accepts, as the API's decimal string", () => {
    expect(indicativeQuotePath("150,000", "24")).toBe(
      "/products/PL/quote?amount=150000.00&tenorMonths=24",
    );
    expect(indicativeQuotePath("19999", "24")).toBeNull();
    expect(indicativeQuotePath("150000", "40")).toBeNull();
    expect(indicativeQuotePath("", "")).toBeNull();
  });
});
