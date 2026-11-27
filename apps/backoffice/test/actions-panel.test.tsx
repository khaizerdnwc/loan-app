import type { CaseDetail } from "@loan/core";
import { ToastProvider } from "@loan/ui";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, vi } from "vitest";
import { ShellRefresh } from "@/components/app-shell";
import { ActionsPanel } from "@/components/case/actions-panel";

afterEach(() => vi.unstubAllGlobals());

function detail(patch: Partial<CaseDetail>): CaseDetail {
  return {
    id: "case-1",
    reference: "APP-1002",
    applicantName: "Joel Reyes",
    productCode: "PL",
    requestedAmount: "200000.00",
    requestedTenorMonths: 36,
    status: "APPROVAL",
    outcome: "REFER",
    grade: "C",
    escalated: false,
    createdAt: "2026-11-28T01:00:00.000Z",
    updatedAt: "2026-11-28T01:00:00.000Z",
    applicant: {
      id: "app-joel",
      fullName: "Joel Reyes",
      birthDate: "1999-04-02",
      ageYears: 27,
      employer: "Synthetic Co.",
      employmentMonths: 40,
      relationshipMonths: 0,
      monthlyIncome: "56000.00",
      monthlyObligations: "11000.00",
      depositAccount: "WB-SAV-0002",
      governmentIdMasked: "••••-2002",
    },
    purpose: "Home improvement",
    createdBy: "paolo",
    decision: null,
    recommendation: {
      by: "paolo",
      byName: "Paolo Tan",
      type: "COUNTER_OFFER",
      amount: "120000.00",
      tenorMonths: 36,
      isOverride: true,
      overrideReason: "OV04",
      rationale: "Lower exposure",
    },
    approved: null,
    decline: null,
    signatureEnvelopeId: null,
    booking: null,
    loanAccountId: null,
    allowedActions: [],
    ...patch,
  };
}

const refreshShell = vi.fn();
afterEach(() => refreshShell.mockReset());

const renderPanel = (c: CaseDetail, onChanged = vi.fn()) =>
  render(
    <ToastProvider>
      <ShellRefresh.Provider value={refreshShell}>
        <ActionsPanel detail={c} onChanged={onChanged} onShowDecision={() => {}} />
      </ShellRefresh.Provider>
    </ToastProvider>,
  );

describe("ActionsPanel shows only what the API allows", () => {
  it("shows a disabled action with the API's reason, so the UI never decides who may act", () => {
    renderPanel(
      detail({
        status: "PENDING_CHECKER",
        allowedActions: [
          {
            action: "APPROVE_BOOKING",
            enabled: false,
            blockedBy: "MAKER_CHECKER_VIOLATION",
            detail: "You submitted this booking; another supervisor must approve it.",
          },
        ],
      }),
    );
    const approve = screen.getByRole("button", { name: "Approve booking" });
    expect(approve).toBeDisabled();
    expect(approve).toHaveAccessibleDescription(/another supervisor/);
  });

  it("lets an approver attempt an approval above their authority, showing why it will be refused, and shows the escalation (R-6)", async () => {
    const escalated = detail({ escalated: true, allowedActions: [] });
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            status: 403,
            code: "AUTHORITY_LIMIT_EXCEEDED",
            detail: "₱120,000.00 is above your approval limit of ₱100,000.00.",
          }),
          { status: 403 },
        ),
      )
      .mockResolvedValueOnce(new Response(JSON.stringify(escalated), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const onChanged = vi.fn();
    renderPanel(
      detail({
        allowedActions: [
          {
            action: "APPROVE",
            enabled: false,
            blockedBy: "AUTHORITY_LIMIT_EXCEEDED",
            detail: "₱120,000.00 at grade C is above your authority (₱100,000.00, grades A–B).",
          },
          { action: "RETURN", enabled: true },
        ],
      }),
      onChanged,
    );
    const approve = screen.getByRole("button", { name: "Approve" });
    expect(approve).toBeEnabled();
    expect(approve).toHaveAccessibleDescription(/above your authority/);
    await userEvent.click(approve);
    const buttons = screen.getAllByRole("button", { name: "Approve" });
    await userEvent.click(buttons[buttons.length - 1] as HTMLElement);
    expect(await screen.findByRole("alert")).toHaveTextContent(/above your approval limit/);
    await vi.waitFor(() => expect(onChanged).toHaveBeenCalledWith(escalated));
    expect(fetchMock).toHaveBeenLastCalledWith("/api/cases/case-1", expect.anything());
  });

  it.each([
    ["PROVIDER_UNAVAILABLE", 503, "Core banking did not answer in time."],
    ["SCHEDULE_DOES_NOT_RECONCILE", 502, "Core banking's schedule was refused."],
  ])(
    "after a booking refused with %s, reloads the case and turns the dialog into the retry (B-5)",
    async (code, status, message) => {
      const failed = detail({
        status: "BOOKING_FAILED",
        allowedActions: [{ action: "RETRY_BOOKING", enabled: true }],
      });
      const fetchMock = vi
        .fn()
        .mockResolvedValueOnce(
          new Response(JSON.stringify({ status, code, detail: message }), { status }),
        )
        .mockResolvedValueOnce(new Response(JSON.stringify(failed), { status: 200 }));
      vi.stubGlobal("fetch", fetchMock);
      const onChanged = vi.fn();
      renderPanel(
        detail({
          status: "PENDING_CHECKER",
          allowedActions: [{ action: "APPROVE_BOOKING", enabled: true }],
        }),
        onChanged,
      );
      await userEvent.click(screen.getByRole("button", { name: "Approve booking" }));
      const buttons = screen.getAllByRole("button", { name: "Approve booking" });
      await userEvent.click(buttons[buttons.length - 1] as HTMLElement);
      expect(await screen.findByRole("alert")).toHaveTextContent(message);
      await vi.waitFor(() => expect(onChanged).toHaveBeenCalledWith(failed));
      expect(await screen.findByRole("button", { name: "Retry booking" })).toBeInTheDocument();
      expect(screen.getByRole("alert")).toHaveTextContent(message);
    },
  );

  it("says to reload when the case cannot be re-read after a refusal that changed it", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            status: 503,
            code: "PROVIDER_UNAVAILABLE",
            detail: "Core banking is unavailable.",
          }),
          { status: 503 },
        ),
      )
      .mockRejectedValueOnce(new TypeError("offline"));
    vi.stubGlobal("fetch", fetchMock);
    renderPanel(
      detail({
        status: "PENDING_CHECKER",
        allowedActions: [{ action: "APPROVE_BOOKING", enabled: true }],
      }),
    );
    await userEvent.click(screen.getByRole("button", { name: "Approve booking" }));
    const buttons = screen.getAllByRole("button", { name: "Approve booking" });
    await userEvent.click(buttons[buttons.length - 1] as HTMLElement);
    expect(
      await screen.findByText(/Reload the page to see the case's current state/),
    ).toBeInTheDocument();
  });

  it("offers Decide again for an outage referral, posts to /redecide, and reports the new outcome (B-10)", async () => {
    const referred = detail({
      status: "REVIEW",
      grade: null,
      decision: {
        reasonCodes: [{ code: "R10", staffText: "Credit bureau unavailable", borrowerText: "" }],
      } as unknown as CaseDetail["decision"],
      allowedActions: [
        { action: "REDECIDE", enabled: true },
        { action: "RECOMMEND", enabled: true },
      ],
    });
    const decided = detail({
      status: "OFFER",
      outcome: "AUTO_APPROVE",
      grade: "A",
      allowedActions: [],
    });
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify(decided), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const onChanged = vi.fn();
    renderPanel(referred, onChanged);

    expect(screen.getByText(/decides it again once the provider is back/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Recommend a decision" })).toHaveClass("bg-white");
    await userEvent.click(screen.getByRole("button", { name: "Decide again" }));
    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveTextContent("Joel Reyes");
    expect(dialog).toHaveTextContent("₱200,000.00 over 36 months");
    expect(dialog).toHaveTextContent(/approved at once, referred to you again, or declined/);
    const confirm = screen.getAllByRole("button", { name: "Decide again" });
    await userEvent.click(confirm[confirm.length - 1] as HTMLElement);
    await vi.waitFor(() => expect(onChanged).toHaveBeenCalledWith(decided));
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/cases/case-1/redecide",
      expect.objectContaining({ method: "POST" }),
    );
    expect(
      await screen.findByText("Decided again — approved; waiting for the borrower's e-signature"),
    ).toBeInTheDocument();
  });

  it("offers no action the API did not list", () => {
    renderPanel(detail({ allowedActions: [] }));
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    expect(screen.getByText(/Waiting for an approver/)).toBeInTheDocument();
  });

  it("confirms an approval with the amount and tenor before posting it", async () => {
    const next = detail({ status: "OFFER", allowedActions: [] });
    const fetchMock = vi.fn(async () => new Response(JSON.stringify(next), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const onChanged = vi.fn();
    renderPanel(detail({ allowedActions: [{ action: "APPROVE", enabled: true }] }), onChanged);

    await userEvent.click(screen.getByRole("button", { name: "Approve" }));
    expect(screen.getByText("Approve ₱120,000.00 over 36 months?")).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();

    const buttons = screen.getAllByRole("button", { name: "Approve" });
    await userEvent.click(buttons[buttons.length - 1] as HTMLElement);
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/cases/case-1/approve",
      expect.objectContaining({ method: "POST" }),
    );
    expect(onChanged).toHaveBeenCalledWith(next);
    expect(refreshShell).toHaveBeenCalled();
  });

  it("shows the API's refusal inline in the dialog", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              status: 403,
              title: "Forbidden",
              code: "MAKER_CHECKER_VIOLATION",
              detail: "You submitted this booking, so another supervisor must approve it.",
            }),
            { status: 403 },
          ),
      ),
    );
    renderPanel(
      detail({
        status: "PENDING_CHECKER",
        allowedActions: [{ action: "APPROVE_BOOKING", enabled: true }],
      }),
    );
    await userEvent.click(screen.getByRole("button", { name: "Approve booking" }));
    const buttons = screen.getAllByRole("button", { name: "Approve booking" });
    await userEvent.click(buttons[buttons.length - 1] as HTMLElement);
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "another supervisor must approve it",
    );
  });

  describe("recommendation", () => {
    const review = () =>
      detail({
        status: "REVIEW",
        recommendation: null,
        allowedActions: [{ action: "RECOMMEND", enabled: true }],
      });
    async function openDialog() {
      await userEvent.click(screen.getByRole("button", { name: "Recommend a decision" }));
    }
    const send = () => userEvent.click(screen.getByRole("button", { name: "Send to approver" }));
    const sentBody = (mock: ReturnType<typeof vi.fn>) =>
      JSON.parse((mock.mock.calls[0] as [string, { body: string }])[1].body);
    const ok = () => vi.fn(async () => new Response(JSON.stringify(review()), { status: 200 }));

    it("approves as requested by default, with no reason code needed", async () => {
      const fetchMock = ok();
      vi.stubGlobal("fetch", fetchMock);
      renderPanel(review());
      await openDialog();
      expect(
        screen.getByText(/approve ₱200,000.00 over 36 months, as requested/),
      ).toBeInTheDocument();
      await userEvent.type(screen.getByLabelText("Rationale"), "Verified salary");
      await send();
      expect(sentBody(fetchMock)).toEqual({ type: "APPROVE", rationale: "Verified salary" });
    });

    it("asks for a reason code when a counter-offer changes the terms, then posts decimal strings", async () => {
      const fetchMock = ok();
      vi.stubGlobal("fetch", fetchMock);
      renderPanel(review());
      await openDialog();
      await userEvent.selectOptions(screen.getByLabelText("Recommendation"), "COUNTER_OFFER");
      const amount = screen.getByLabelText("Amount (pesos)");
      await userEvent.clear(amount);
      await userEvent.type(amount, "120,000");
      expect(screen.getByText("Counter-offer: ₱120,000.00 over 36 months.")).toBeInTheDocument();
      await userEvent.type(screen.getByLabelText("Rationale"), "Thin file, verified salary");
      await send();
      expect(screen.getByLabelText(/Reason code/)).toHaveAccessibleDescription(
        /choose a reason code/i,
      );
      expect(fetchMock).not.toHaveBeenCalled();

      await userEvent.selectOptions(screen.getByLabelText(/Reason code/), "OV04");
      await send();
      expect(sentBody(fetchMock)).toEqual({
        type: "COUNTER_OFFER",
        amount: "120000.00",
        tenorMonths: 36,
        overrideReason: "OV04",
        rationale: "Thin file, verified salary",
      });
    });

    it("needs a reason for a counter-offer only when the terms change", async () => {
      const fetchMock = ok();
      vi.stubGlobal("fetch", fetchMock);
      renderPanel(review());
      await openDialog();
      await userEvent.selectOptions(screen.getByLabelText("Recommendation"), "COUNTER_OFFER");
      expect(screen.getByLabelText(/Reason code/)).toHaveAccessibleName(/optional/);
      await userEvent.type(screen.getByLabelText("Rationale"), "Same terms");
      await send();
      expect(sentBody(fetchMock)).toMatchObject({ type: "COUNTER_OFFER", amount: "200000.00" });
    });

    it("refuses a malformed tenor locally instead of sending null", async () => {
      const fetchMock = ok();
      vi.stubGlobal("fetch", fetchMock);
      renderPanel(review());
      await openDialog();
      await userEvent.selectOptions(screen.getByLabelText("Recommendation"), "COUNTER_OFFER");
      const tenor = screen.getByLabelText("Tenor (months)");
      await userEvent.clear(tenor);
      await userEvent.type(tenor, "abc");
      await userEvent.type(screen.getByLabelText("Rationale"), "Rationale here");
      await send();
      expect(tenor).toHaveAccessibleDescription(/whole number of months/);
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it("a decline needs a reason and sends no amount or tenor", async () => {
      const fetchMock = ok();
      vi.stubGlobal("fetch", fetchMock);
      renderPanel(review());
      await openDialog();
      await userEvent.selectOptions(screen.getByLabelText("Recommendation"), "DECLINE");
      expect(screen.queryByLabelText("Amount (pesos)")).not.toBeInTheDocument();
      await userEvent.selectOptions(screen.getByLabelText(/Reason code/), "OV04");
      await userEvent.type(screen.getByLabelText("Rationale"), "Not affordable");
      await send();
      expect(sentBody(fetchMock)).toEqual({
        type: "DECLINE",
        overrideReason: "OV04",
        rationale: "Not affordable",
      });
    });

    it("refuses a rationale under five characters", async () => {
      vi.stubGlobal("fetch", vi.fn());
      renderPanel(review());
      await openDialog();
      await userEvent.type(screen.getByLabelText("Rationale"), "ok");
      await send();
      expect(screen.getByLabelText("Rationale")).toHaveAccessibleDescription(/short rationale/);
      expect(fetch).not.toHaveBeenCalled();
    });

    it("shows the API's field errors next to the matching field", async () => {
      vi.stubGlobal(
        "fetch",
        vi.fn(
          async () =>
            new Response(
              JSON.stringify({
                status: 400,
                code: "VALIDATION_FAILED",
                detail: "Check the counter-offer terms.",
                errors: [{ field: "amount", message: "The amount must be at least ₱20,000.00." }],
              }),
              { status: 400 },
            ),
        ),
      );
      renderPanel(review());
      await openDialog();
      await userEvent.selectOptions(screen.getByLabelText("Recommendation"), "COUNTER_OFFER");
      const amount = screen.getByLabelText("Amount (pesos)");
      await userEvent.clear(amount);
      await userEvent.type(amount, "120000");
      await userEvent.selectOptions(screen.getByLabelText(/Reason code/), "OV04");
      await userEvent.type(screen.getByLabelText("Rationale"), "Smaller loan");
      await send();
      expect(await screen.findByRole("alert")).toHaveTextContent("Check the counter-offer terms.");
      expect(amount).toHaveAccessibleDescription(/at least ₱20,000.00/);
    });

    it.each([
      ["1000", /between ₱20,000.00 and ₱500,000.00/],
      ["600000", /between ₱20,000.00 and ₱500,000.00/],
      ["12abc", /amount in pesos/],
    ])(
      "refuses the counter-offer amount %p locally, with no summary and no request",
      async (typed, message) => {
        const fetchMock = ok();
        vi.stubGlobal("fetch", fetchMock);
        renderPanel(review());
        await openDialog();
        await userEvent.selectOptions(screen.getByLabelText("Recommendation"), "COUNTER_OFFER");
        const amount = screen.getByLabelText("Amount (pesos)");
        await userEvent.clear(amount);
        await userEvent.type(amount, typed);
        expect(
          screen.getByText("Counter-offer: enter a valid amount and tenor."),
        ).toBeInTheDocument();
        await userEvent.selectOptions(screen.getByLabelText(/Reason code/), "OV04");
        await userEvent.type(screen.getByLabelText("Rationale"), "Smaller loan");
        await send();
        expect(amount).toHaveAccessibleDescription(message);
        expect(fetchMock).not.toHaveBeenCalled();
      },
    );
  });

  it("a decline by the approver needs a reason code", async () => {
    vi.stubGlobal("fetch", vi.fn());
    renderPanel(detail({ allowedActions: [{ action: "DECLINE", enabled: true }] }));
    await userEvent.click(screen.getByRole("button", { name: "Decline" }));
    const buttons = screen.getAllByRole("button", { name: "Decline" });
    await userEvent.click(buttons[buttons.length - 1] as HTMLElement);
    expect(screen.getByLabelText("Reason code")).toHaveAccessibleDescription(
      /Choose a reason code/,
    );
    expect(fetch).not.toHaveBeenCalled();
  });
});
