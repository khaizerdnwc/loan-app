import type { CaseDetail, CaseSummary } from "@loan/core";
import { ToastProvider } from "@loan/ui";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, vi } from "vitest";
import { ShellRefresh } from "@/components/app-shell";
import { ActionsPanel } from "@/components/case/actions-panel";
import { ReassignDialog } from "@/components/case/routing-dialogs";
import { CaseTable } from "@/components/case-table";
import { NewApplicantDialog } from "@/components/new-applicant-dialog";

afterEach(() => vi.unstubAllGlobals());

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

const wrap = (ui: React.ReactNode) =>
  render(
    <ToastProvider>
      <ShellRefresh.Provider value={vi.fn()}>{ui}</ShellRefresh.Provider>
    </ToastProvider>,
  );

const SUMMARY: CaseSummary = {
  id: "case-1",
  reference: "APP-1002",
  applicantName: "Joel Reyes",
  productCode: "PL",
  requestedAmount: "200000.00",
  requestedTenorMonths: 36,
  status: "REVIEW",
  outcome: "REFER",
  grade: "C",
  escalated: false,
  ownerId: null,
  ownerName: null,
  channel: "BRANCH",
  priority: "HIGH",
  reason: "Thin bureau file",
  reasonCount: 1,
  createdAt: "2026-11-28T01:00:00.000Z",
  updatedAt: "2026-11-28T01:00:00.000Z",
};

describe("the queue shows owner, channel, priority and the top reason (QR-1)", () => {
  it("an unassigned referral reads Unassigned with its channel, and offers Pick when the queue can pick", async () => {
    const onPick = vi.fn();
    render(<CaseTable cases={[SUMMARY]} empty="none" onPick={onPick} />);
    const row = screen.getAllByRole("row")[1] as HTMLElement;
    expect(row).toHaveTextContent("Unassigned");
    expect(row).toHaveTextContent("Branch");
    expect(row).toHaveTextContent("High priority");
    expect(row).toHaveTextContent("Thin bureau file");
    await userEvent.click(within(row).getByRole("button", { name: "Pick Joel Reyes's case" }));
    expect(onPick).toHaveBeenCalledWith(SUMMARY);
  });

  it("an owned case names its owner and offers no Pick", () => {
    render(
      <CaseTable
        cases={[{ ...SUMMARY, ownerId: "STF-JOY", ownerName: "Joy Dela Cruz" }]}
        empty="none"
        onPick={vi.fn()}
      />,
    );
    const row = screen.getAllByRole("row")[1] as HTMLElement;
    expect(row).toHaveTextContent("Joy Dela Cruz");
    expect(within(row).queryByRole("button", { name: /Pick/ })).not.toBeInTheDocument();
  });
});

function detail(patch: Partial<CaseDetail>): CaseDetail {
  return {
    ...SUMMARY,
    priority: "NORMAL",
    applicant: { fullName: "Joel Reyes" },
    documents: [],
    infoRequest: null,
    allowedActions: [],
    ...patch,
  } as unknown as CaseDetail;
}

describe("routing actions on the case (QR-1)", () => {
  it("Pick confirms what happens, then posts it", async () => {
    const mine = detail({ ownerId: "STF-PAOLO", ownerName: "Paolo Tan" });
    const fetchMock = vi.fn().mockResolvedValue(json(mine));
    vi.stubGlobal("fetch", fetchMock);
    const onChanged = vi.fn();
    wrap(
      <ActionsPanel
        detail={detail({ allowedActions: [{ action: "PICK", enabled: true }] })}
        onChanged={onChanged}
        onShowDecision={vi.fn()}
      />,
    );
    await userEvent.click(screen.getByRole("button", { name: "Pick this case" }));
    expect(screen.getByRole("dialog")).toHaveTextContent("It becomes yours");
    await userEvent.click(
      within(screen.getByRole("dialog")).getByRole("button", { name: "Pick this case" }),
    );
    await vi.waitFor(() => expect(onChanged).toHaveBeenCalledWith(mine));
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/cases/case-1/pick",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("Change priority is a tool; it marks a normal case high", async () => {
    const fetchMock = vi.fn().mockResolvedValue(json(detail({ priority: "HIGH" })));
    vi.stubGlobal("fetch", fetchMock);
    wrap(
      <ActionsPanel
        detail={detail({ allowedActions: [{ action: "SET_PRIORITY", enabled: true }] })}
        onChanged={vi.fn()}
        onShowDecision={vi.fn()}
      />,
    );
    const tool = screen.getByRole("button", { name: "Change priority" });
    expect(tool.closest("[data-group]")).toHaveAttribute("data-group", "tools");
    await userEvent.click(tool);
    await userEvent.click(
      within(screen.getByRole("dialog")).getByRole("button", { name: "Mark high priority" }),
    );
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const [path, init] = fetchMock.mock.calls[0] as [string, { body: string }];
    expect(path).toBe("/api/cases/case-1/priority");
    expect(JSON.parse(init.body)).toEqual({ priority: "HIGH" });
  });

  it("Reassign offers every loan officer but the owner, least loaded first, and needs a reason", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        json([
          { id: "STF-JOY", fullName: "Joy Dela Cruz", openCases: 4 },
          { id: "STF-PAOLO", fullName: "Paolo Tan", openCases: 1 },
          { id: "STF-ANNA", fullName: "Anna Lim", openCases: 2 },
        ]),
      ),
    );
    const onSubmit = vi.fn();
    wrap(
      <ReassignDialog
        detail={detail({ ownerId: "STF-PAOLO", ownerName: "Paolo Tan" })}
        busy={false}
        error={null}
        fieldErrors={{}}
        onCancel={vi.fn()}
        onSubmit={onSubmit}
      />,
    );
    const select = await screen.findByLabelText("New owner");
    await vi.waitFor(() =>
      expect(
        within(select)
          .getAllByRole("option")
          .map((o) => o.textContent),
      ).toEqual(["Anna Lim · 2 open cases", "Joy Dela Cruz · 4 open cases"]),
    );
    expect(select).toHaveValue("STF-ANNA");
    await userEvent.click(screen.getByRole("button", { name: "Reassign" }));
    expect(screen.getByText("Enter a reason for the reassignment.")).toBeInTheDocument();
    expect(onSubmit).not.toHaveBeenCalled();
    await userEvent.type(screen.getByLabelText("Reason"), "Balancing the load.");
    await userEvent.click(screen.getByRole("button", { name: "Reassign" }));
    expect(onSubmit).toHaveBeenCalledWith({ ownerId: "STF-ANNA", reason: "Balancing the load." });
  });
});

const CORE_CUSTOMER = {
  customerNumber: "CIF-100245",
  fullName: "Lorna Bautista",
  birthDate: "1990-03-17",
  governmentIdLast4: "5521",
  employer: "Makati Medical Supplies Inc.",
  employmentMonths: 52,
  monthlyIncome: "64000.00",
  monthlyObligations: "7500.00",
  relationshipMonths: 61,
  depositAccount: "WB-SAV-0245-1180",
  providerMode: "SIMULATED",
  applicantId: null,
};

describe("New or walk-in customer (WI-1)", () => {
  it("finds a core customer, shows what core says (simulated), and adds them with the customer number", async () => {
    const created = { id: "APL-W0000000001", fullName: "Lorna Bautista" };
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(json(CORE_CUSTOMER))
      .mockResolvedValueOnce(json(created, 201));
    vi.stubGlobal("fetch", fetchMock);
    const onCreated = vi.fn();
    wrap(
      <NewApplicantDialog onCancel={vi.fn()} onCreated={onCreated} onChooseExisting={vi.fn()} />,
    );
    await userEvent.type(screen.getByLabelText("Customer number"), "CIF-100245");
    await userEvent.click(screen.getByRole("button", { name: "Find in core" }));
    const found = await screen.findByTestId("core-customer");
    expect(found).toHaveTextContent("Simulated · core customer file");
    expect(found).toHaveTextContent("Lorna Bautista");
    expect(found).toHaveTextContent("₱64,000.00");
    expect(screen.getByLabelText("Declared monthly income (pesos)")).toHaveValue("64000.00");
    await userEvent.click(screen.getByRole("button", { name: "Add applicant" }));
    await vi.waitFor(() => expect(onCreated).toHaveBeenCalledWith(created));
    const [, init] = fetchMock.mock.calls[1] as [string, { body: string }];
    expect(JSON.parse(init.body)).toMatchObject({
      customerNumber: "CIF-100245",
      employer: "Makati Medical Supplies Inc.",
      monthlyIncome: "64000.00",
    });
  });

  it("when core is down it says so and still lets the officer capture by hand", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        json(
          {
            status: 503,
            code: "PROVIDER_UNAVAILABLE",
            detail:
              "Core banking's customer file is not answering. Capture the applicant by hand as a new customer, or try again.",
          },
          503,
        ),
      )
      .mockResolvedValueOnce(json({ id: "APL-W0000000002", fullName: "Rogelio Santiago" }, 201));
    vi.stubGlobal("fetch", fetchMock);
    wrap(<NewApplicantDialog onCancel={vi.fn()} onCreated={vi.fn()} onChooseExisting={vi.fn()} />);
    await userEvent.type(screen.getByLabelText("Customer number"), "CIF-100388");
    await userEvent.click(screen.getByRole("button", { name: "Find in core" }));
    expect(await screen.findByText("Core banking is not answering.")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Capture by hand" }));
    await userEvent.type(screen.getByLabelText("Full name"), "Rogelio Santiago");
    await userEvent.type(screen.getByLabelText("Birth date"), "1988-06-12");
    await userEvent.type(screen.getByLabelText("Government ID (last 4 digits)"), "4410");
    await userEvent.type(screen.getByLabelText("Employer"), "Bulacan Hardware Trading");
    await userEvent.type(screen.getByLabelText("Months with employer"), "36");
    await userEvent.type(screen.getByLabelText("Monthly income (pesos)"), "52,000");
    await userEvent.type(screen.getByLabelText("Monthly obligations (pesos)"), "6000");
    await userEvent.click(screen.getByRole("button", { name: "Add applicant" }));
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    const [path, init] = fetchMock.mock.calls[1] as [string, { body: string }];
    expect(path).toBe("/api/applicants");
    const body = JSON.parse(init.body);
    expect(body).not.toHaveProperty("customerNumber");
    expect(body).toMatchObject({
      fullName: "Rogelio Santiago",
      birthDate: "1988-06-12",
      monthlyIncome: "52000.00",
      monthlyObligations: "6000.00",
      employmentMonths: 36,
    });
  });

  it("a customer already on file is chosen, not captured twice", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(json({ ...CORE_CUSTOMER, applicantId: "APL-W0000000001" })),
    );
    const onChooseExisting = vi.fn();
    wrap(
      <NewApplicantDialog
        onCancel={vi.fn()}
        onCreated={vi.fn()}
        onChooseExisting={onChooseExisting}
      />,
    );
    await userEvent.type(screen.getByLabelText("Customer number"), "CIF-100245");
    await userEvent.click(screen.getByRole("button", { name: "Find in core" }));
    const choose = await screen.findByRole("button", { name: "Choose them" });
    // Adding them again would be refused: Add applicant is disabled, with the reason.
    const add = screen.getByRole("button", { name: "Add applicant" });
    expect(add).toBeDisabled();
    expect(add).toHaveAccessibleDescription(
      "This customer is already on file: choose them instead.",
    );
    await userEvent.click(choose);
    expect(onChooseExisting).toHaveBeenCalledWith("APL-W0000000001", "Lorna Bautista");
  });

  it("Add applicant waits until a customer is found, and is open by hand; no account can be typed", async () => {
    wrap(<NewApplicantDialog onCancel={vi.fn()} onCreated={vi.fn()} onChooseExisting={vi.fn()} />);
    const add = screen.getByRole("button", { name: "Add applicant" });
    expect(add).toBeDisabled();
    expect(add).toHaveAccessibleDescription(
      "Find the customer in core banking first, or capture a customer new to the bank.",
    );
    await userEvent.click(screen.getByRole("button", { name: "New to the bank" }));
    expect(screen.getByRole("button", { name: "Add applicant" })).toBeEnabled();
    expect(screen.queryByLabelText(/deposit account/i)).not.toBeInTheDocument();
    expect(screen.getByText(/has no WhiteBank deposit account yet/)).toBeInTheDocument();
  });

  it("the queue's Pick is busy while its request is in flight, so a double click sends one", async () => {
    const onPick = vi.fn();
    const { rerender } = render(<CaseTable cases={[SUMMARY]} empty="none" onPick={onPick} />);
    rerender(<CaseTable cases={[SUMMARY]} empty="none" onPick={onPick} busyId="case-1" />);
    const pick = screen.getByRole("button", { name: "Pick Joel Reyes's case" });
    expect(pick).toBeDisabled();
    await userEvent.click(pick);
    expect(onPick).not.toHaveBeenCalled();
  });
});
