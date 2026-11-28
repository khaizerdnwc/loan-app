import type { AmlEscalationView } from "@loan/core";
import { ToastProvider } from "@loan/ui";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, vi } from "vitest";
import { EscalationActions } from "@/components/compliance/escalation-actions";

afterEach(() => vi.unstubAllGlobals());

const escalation = (patch: Partial<AmlEscalationView> = {}): AmlEscalationView => ({
  id: "esc-1",
  caseId: "case-1",
  caseReference: "APP-1046",
  applicantName: "Dario Mercado",
  stage: "PRE_DISBURSEMENT",
  matchedList: "Simulated watchlist (updated list)",
  providerMode: "SIMULATED",
  screenedAt: "2026-11-28T01:00:00.000Z",
  status: "OPEN",
  openedAt: "2026-11-28T01:00:00.000Z",
  openedByName: "Ella Reyes",
  acknowledgedAt: null,
  acknowledgedByName: null,
  closedAt: null,
  closedByName: null,
  outcome: null,
  notes: null,
  priorBookingAttempts: 0,
  effect: "The booking is held.",
  ...patch,
});

const renderActions = (e: AmlEscalationView, onChanged = vi.fn()) =>
  render(
    <ToastProvider>
      <EscalationActions escalation={e} onChanged={onChanged} />
    </ToastProvider>,
  );

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

describe("EscalationActions (CMP-1, CMP-2)", () => {
  it("is the page's Next action region, as on the case page, with the actions inside it", () => {
    renderActions(escalation());
    const next = screen.getByRole("region", { name: "Next action" });
    expect(within(next).getByRole("button", { name: "Acknowledge" })).toBeInTheDocument();
  });

  it("acknowledges an open escalation after confirming, and hands back the result", async () => {
    const acked = escalation({ status: "ACKNOWLEDGED", acknowledgedByName: "Diane Yu" });
    const fetchMock = vi.fn().mockResolvedValueOnce(json(acked));
    vi.stubGlobal("fetch", fetchMock);
    const onChanged = vi.fn();
    renderActions(escalation(), onChanged);

    await userEvent.click(screen.getByRole("button", { name: "Acknowledge" }));
    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveTextContent("APP-1046");
    await userEvent.click(within(dialog).getByRole("button", { name: "Acknowledge" }));

    await vi.waitFor(() => expect(onChanged).toHaveBeenCalledWith(acked));
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/compliance/escalations/esc-1/acknowledge");
    expect(init.method).toBe("POST");
  });

  it("closes with the chosen outcome and notes, saying what the outcome does to the booking", async () => {
    const closed = escalation({ status: "CLOSED", outcome: "CONFIRMED_MATCH", notes: "Listed." });
    const fetchMock = vi.fn().mockResolvedValueOnce(json(closed));
    vi.stubGlobal("fetch", fetchMock);
    renderActions(escalation({ status: "ACKNOWLEDGED" }));

    expect(screen.queryByRole("button", { name: "Acknowledge" })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Close escalation" }));
    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveTextContent(/can retry the booking/);
    await userEvent.selectOptions(within(dialog).getByLabelText("Outcome"), "CONFIRMED_MATCH");
    expect(dialog).toHaveTextContent(/stays blocked/);
    await userEvent.type(within(dialog).getByLabelText("Closing notes"), "Listed.");
    await userEvent.click(within(dialog).getByRole("button", { name: "Close escalation" }));

    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/compliance/escalations/esc-1/close");
    expect(JSON.parse(String(init.body))).toEqual({ outcome: "CONFIRMED_MATCH", notes: "Listed." });
  });

  it("shows the API's refusal in words, next to the notes field, and stays open", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValueOnce(
        json(
          {
            type: "about:blank",
            title: "Bad Request",
            status: 400,
            code: "VALIDATION_FAILED",
            detail: "Explain how the escalation was resolved.",
            errors: [{ field: "notes", message: "Enter the closing notes." }],
          },
          400,
        ),
      ),
    );
    const onChanged = vi.fn();
    renderActions(escalation(), onChanged);

    await userEvent.click(screen.getByRole("button", { name: "Close escalation" }));
    const dialog = screen.getByRole("dialog");
    await userEvent.click(within(dialog).getByRole("button", { name: "Close escalation" }));

    expect(await within(dialog).findByRole("alert")).toHaveTextContent(
      "Explain how the escalation was resolved.",
    );
    expect(within(dialog).getByText("Enter the closing notes.")).toBeInTheDocument();
    expect(onChanged).not.toHaveBeenCalled();
  });

  it("when a colleague acted first, re-reads the escalation, closes the dialog and says why", async () => {
    const closed = escalation({ status: "CLOSED", outcome: "FALSE_POSITIVE", effect: "Cleared." });
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        json(
          {
            type: "about:blank",
            title: "Conflict",
            status: 409,
            code: "INVALID_STATE_TRANSITION",
            detail: "This escalation is already acknowledged.",
          },
          409,
        ),
      )
      .mockResolvedValueOnce(json(closed));
    vi.stubGlobal("fetch", fetchMock);
    const onChanged = vi.fn();
    renderActions(escalation(), onChanged);

    await userEvent.click(screen.getByRole("button", { name: "Acknowledge" }));
    await userEvent.click(
      within(screen.getByRole("dialog")).getByRole("button", { name: "Acknowledge" }),
    );

    await vi.waitFor(() => expect(onChanged).toHaveBeenCalledWith(closed));
    expect(String(fetchMock.mock.calls[1]?.[0])).toBe("/api/compliance/escalations/esc-1");
    await vi.waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(await screen.findByText("This escalation is already acknowledged.")).toBeInTheDocument();
  });

  it("a closed escalation offers no action and says how it closed", () => {
    renderActions(
      escalation({ status: "CLOSED", outcome: "FALSE_POSITIVE", effect: "Cleared: retry." }),
    );
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    expect(screen.getByText(/Cleared: false positive\. Cleared: retry\./)).toBeInTheDocument();
  });
});
