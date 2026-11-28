import type { AutomationView } from "@loan/core";
import { ToastProvider } from "@loan/ui";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, vi } from "vitest";
import { AutomationPanel } from "@/components/automation/automation-panel";

afterEach(() => vi.unstubAllGlobals());

const view = (patch: Partial<AutomationView>): AutomationView => ({
  productCode: "PL",
  productName: "Personal loan",
  mode: "LIVE",
  killSwitch: false,
  killSwitchSetByName: null,
  killSwitchSetAt: null,
  externalEngine: "NONE",
  updatedAt: "2026-11-28T01:00:00.000Z",
  pendingChange: null,
  allowedActions: [
    { action: "REQUEST_MODE_CHANGE", enabled: true },
    { action: "KILL_SWITCH_ON", enabled: true },
  ],
  ...patch,
});

const renderPanel = (views: AutomationView[], onChanged = vi.fn()) =>
  render(
    <ToastProvider>
      <AutomationPanel views={views} onChanged={onChanged} />
    </ToastProvider>,
  );

describe("AutomationPanel (AU-1, AU-3)", () => {
  it("drafts a mode change with a reason, and hands back what the API returns", async () => {
    const drafted = [view({})];
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify(drafted), { status: 201 }));
    vi.stubGlobal("fetch", fetchMock);
    const onChanged = vi.fn();
    renderPanel([view({})], onChanged);

    // Choosing a mode does not act by itself; the button opens the confirmation.
    expect(screen.getByRole("button", { name: "Draft change…" })).toBeDisabled();
    await userEvent.selectOptions(screen.getByLabelText("Change mode for Personal loan"), "SHADOW");
    expect(screen.queryByRole("dialog")).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "Draft change…" }));
    expect(screen.getByRole("dialog")).toHaveTextContent(/second administrator approves/);
    // No reason, no request.
    await userEvent.click(screen.getByRole("button", { name: "Draft change" }));
    expect(screen.getByText("Enter a reason.")).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();

    await userEvent.type(screen.getByLabelText("Reason"), "Pilot");
    await userEvent.click(screen.getByRole("button", { name: "Draft change" }));
    await vi.waitFor(() => expect(onChanged).toHaveBeenCalledWith(drafted));
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/automation/PL/changes");
    expect(JSON.parse(String(init.body))).toEqual({
      kind: "SET_MODE",
      mode: "SHADOW",
      reason: "Pilot",
    });
  });

  it("shows the drafter's approval disabled with the API's reason, and offers a withdrawal", () => {
    renderPanel([
      view({
        pendingChange: {
          id: "c1",
          productCode: "PL",
          kind: "SET_MODE",
          requestedMode: "OFF",
          fromMode: "LIVE",
          requestedExternalEngine: null,
          fromExternalEngine: "NONE",
          reason: "Incident",
          status: "PENDING",
          requestedBy: "STF-LEO",
          requestedByName: "Leo Santiago",
          requestedAt: "2026-11-28T01:00:00.000Z",
          decidedBy: null,
          decidedByName: null,
          decidedAt: null,
        },
        allowedActions: [
          {
            action: "REQUEST_MODE_CHANGE",
            enabled: false,
            blockedBy: "CONFLICT",
            detail: "A change is waiting for approval: approve or reject it first.",
          },
          { action: "KILL_SWITCH_ON", enabled: true },
          {
            action: "APPROVE_CHANGE",
            enabled: false,
            blockedBy: "MAKER_CHECKER_VIOLATION",
            detail: "You drafted this change; a different administrator must approve it.",
          },
          { action: "WITHDRAW_CHANGE", enabled: true },
        ],
      }),
    ]);
    expect(screen.getByText(/change from Live to Off/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Reject change" })).toBeNull();
    expect(screen.getByRole("button", { name: "Approve change" })).toBeDisabled();
    // A blocked action's reason reads like the case's: in the error colour under the button.
    expect(screen.getByText(/a different administrator must approve it/).className).toMatch(
      /text-bad-700/,
    );
    expect(screen.getByRole("button", { name: "Withdraw request" })).toBeEnabled();
    expect(screen.getByLabelText("Change mode for Personal loan")).toBeDisabled();
  });

  it("with the kill switch on, says so and offers only a request to turn it off", () => {
    renderPanel([
      view({
        killSwitch: true,
        killSwitchSetByName: "Leo Santiago",
        killSwitchSetAt: "2026-11-28T01:00:00.000Z",
        allowedActions: [
          { action: "REQUEST_MODE_CHANGE", enabled: true },
          { action: "REQUEST_KILL_SWITCH_OFF", enabled: true },
        ],
      }),
    ]);
    expect(screen.getByText("Kill switch on")).toBeInTheDocument();
    expect(screen.getByText(/Turned on by Leo Santiago/)).toBeInTheDocument();
    // The shared facts block (KeyValues): each label holds its value in one wrapper.
    expect(screen.getByText("Mode").tagName).toBe("DT");
    expect(screen.getByText("Kill switch", { selector: "dt" }).parentElement).toHaveTextContent(
      /Turned on by Leo Santiago/,
    );
    expect(screen.queryByRole("button", { name: "Turn kill switch on" })).toBeNull();
    expect(screen.getByRole("button", { name: "Request kill switch off" })).toBeEnabled();
  });

  it("after a refusal, re-reads the products and moves the error onto the card when the action is gone", async () => {
    const pendingChange = {
      id: "c1",
      productCode: "PL",
      kind: "SET_MODE" as const,
      requestedMode: "OFF" as const,
      fromMode: "LIVE" as const,
      requestedExternalEngine: null,
      fromExternalEngine: "NONE" as const,
      reason: "Incident",
      status: "PENDING" as const,
      requestedBy: "STF-LEO",
      requestedByName: "Leo Santiago",
      requestedAt: "2026-11-28T01:00:00.000Z",
      decidedBy: null,
      decidedByName: null,
      decidedAt: null,
    };
    const before = view({
      pendingChange,
      allowedActions: [
        { action: "APPROVE_CHANGE", enabled: true },
        { action: "REJECT_CHANGE", enabled: true },
      ],
    });
    const after = view({ allowedActions: [{ action: "REQUEST_MODE_CHANGE", enabled: true }] });
    const problem = {
      type: "about:blank",
      title: "Conflict",
      status: 409,
      code: "INVALID_STATE_TRANSITION",
      detail: "This request was already rejected.",
    };
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify(problem), { status: 409 }))
      .mockResolvedValueOnce(new Response(JSON.stringify([after]), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const onChanged = vi.fn();
    renderPanel([before], onChanged);

    await userEvent.click(screen.getByRole("button", { name: "Approve change" }));
    const buttons = screen.getAllByRole("button", { name: "Approve change" });
    await userEvent.click(buttons[buttons.length - 1] as HTMLElement);

    await vi.waitFor(() => expect(onChanged).toHaveBeenCalledWith([after]));
    expect((fetchMock.mock.calls[1] as [string])[0]).toBe("/api/automation");
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.getByRole("alert")).toHaveTextContent("This request was already rejected.");
  });

  it("closes a refused mode draft when the product is already in that mode", async () => {
    const problem = {
      type: "about:blank",
      title: "Bad request",
      status: 400,
      code: "VALIDATION_FAILED",
      detail: "Personal loan is already shadow mode.",
    };
    const fresh = view({ mode: "SHADOW" });
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify(problem), { status: 400 }))
      .mockResolvedValueOnce(new Response(JSON.stringify([fresh]), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const onChanged = vi.fn();
    renderPanel([view({})], onChanged);

    await userEvent.selectOptions(screen.getByLabelText("Change mode for Personal loan"), "SHADOW");
    await userEvent.click(screen.getByRole("button", { name: "Draft change…" }));
    await userEvent.type(screen.getByLabelText("Reason"), "Pilot");
    await userEvent.click(screen.getByRole("button", { name: "Draft change" }));

    await vi.waitFor(() => expect(onChanged).toHaveBeenCalledWith([fresh]));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.getByRole("alert")).toHaveTextContent("already shadow mode");
  });

  it("EX-2: shows the external engine's role (simulated) and drafts a role change with a reason", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify([view({})]), { status: 201 }));
    vi.stubGlobal("fetch", fetchMock);
    const onChanged = vi.fn();
    renderPanel(
      [
        view({
          allowedActions: [
            { action: "REQUEST_MODE_CHANGE", enabled: true },
            { action: "REQUEST_EXTERNAL_ENGINE_CHANGE", enabled: true },
          ],
        }),
      ],
      onChanged,
    );
    expect(
      screen.getByText("External decision engine", { selector: "dt" }).parentElement,
    ).toHaveTextContent(/Not used.*Client decision engine \(simulated\)/);

    const draft = screen.getByRole("button", { name: "Draft engine change…" });
    expect(draft).toBeDisabled();
    expect(screen.getByText("The built-in engine decides alone.")).toBeInTheDocument();
    await userEvent.selectOptions(
      screen.getByLabelText("External decision engine for Personal loan"),
      "ALONGSIDE",
    );
    // The effect of the role chosen, before the dialog opens.
    expect(
      screen.getByText(/^If changed: The client's decision engine is asked as well/),
    ).toBeInTheDocument();
    await userEvent.click(draft);
    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveTextContent(/disagrees with the built-in engine/);
    expect(dialog).toHaveTextContent(/never declined for that/);
    await userEvent.type(screen.getByLabelText("Reason"), "Client engine pilot");
    await userEvent.click(screen.getByRole("button", { name: "Draft change" }));

    await vi.waitFor(() => expect(onChanged).toHaveBeenCalled());
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/automation/PL/changes");
    expect(JSON.parse(String(init.body))).toEqual({
      kind: "SET_EXTERNAL_ENGINE",
      externalEngine: "ALONGSIDE",
      reason: "Client engine pilot",
    });
  });

  it("EX-2: a pending role change reads in words for the approver", () => {
    renderPanel([
      view({
        pendingChange: {
          id: "c2",
          productCode: "PL",
          kind: "SET_EXTERNAL_ENGINE",
          requestedMode: null,
          fromMode: "LIVE",
          requestedExternalEngine: "INSTEAD",
          fromExternalEngine: "NONE",
          reason: "Client owns its engine",
          status: "PENDING",
          requestedBy: "STF-LEO",
          requestedByName: "Leo Santiago",
          requestedAt: "2026-11-28T01:00:00.000Z",
          decidedBy: null,
          decidedByName: null,
          decidedAt: null,
        },
        allowedActions: [
          { action: "APPROVE_CHANGE", enabled: true },
          { action: "REJECT_CHANGE", enabled: true },
        ],
      }),
    ]);
    expect(
      screen.getByText(
        /change the external decision engine from “Not used” to “Instead of the built-in engine”/,
      ),
    ).toBeInTheDocument();
  });

  it("offers compliance nothing to change", () => {
    renderPanel([view({ allowedActions: [] })]);
    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.queryByLabelText("Change mode for Personal loan")).toBeNull();
    expect(screen.getByText("Only an administrator can change automation.")).toBeInTheDocument();
  });
});
