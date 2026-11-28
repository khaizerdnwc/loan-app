import type { FeatureFlagView } from "@loan/core";
import { ToastProvider } from "@loan/ui";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, vi } from "vitest";
import { FeatureFlagsPanel } from "@/components/features/feature-flags-panel";

afterEach(() => vi.unstubAllGlobals());

const view = (patch: Partial<FeatureFlagView> = {}): FeatureFlagView => ({
  key: "EMAIL_INTAKE",
  label: "Email and file intake",
  enabled: true,
  updatedAt: "2026-11-28T01:00:00.000Z",
  updatedByName: null,
  pendingChange: null,
  allowedActions: { request: true, approve: false, reject: false, approveBlockedReason: null },
  ...patch,
});

const pending = {
  id: "c1",
  enabled: false,
  reason: "Pilot paused",
  requestedByName: "Leo Ramos",
  requestedAt: "2026-11-28T02:00:00.000Z",
};

const renderPanel = (views: FeatureFlagView[], onChanged = vi.fn()) =>
  render(
    <ToastProvider>
      <FeatureFlagsPanel views={views} onChanged={onChanged} />
    </ToastProvider>,
  );

describe("FeatureFlagsPanel (FF-5, PRD PLT-006)", () => {
  it("names each module's card as a region, so a journey and a screen reader find it by title", () => {
    renderPanel([view()]);
    expect(screen.getByRole("region", { name: "Email and file intake" })).toBeInTheDocument();
  });

  it("drafts switching a module off only with a reason, after a confirmation that says nothing changes yet", async () => {
    const drafted = [view({ pendingChange: pending })];
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify(drafted), { status: 201 }));
    vi.stubGlobal("fetch", fetchMock);
    const onChanged = vi.fn();
    renderPanel([view()], onChanged);

    expect(screen.getByText("On")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Request switch off…" }));
    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveTextContent(/Ask to switch Email and file intake off\?/);
    expect(dialog).toHaveTextContent(/Nothing changes until a second administrator approves it/);
    // No reason, no request.
    await userEvent.click(screen.getByRole("button", { name: "Draft change" }));
    expect(screen.getByText("Enter a reason.")).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();

    await userEvent.type(screen.getByLabelText("Reason"), "Pilot paused");
    await userEvent.click(screen.getByRole("button", { name: "Draft change" }));
    await vi.waitFor(() => expect(onChanged).toHaveBeenCalledWith(drafted));
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/features/flags/EMAIL_INTAKE/changes");
    expect(JSON.parse(String(init.body))).toEqual({ enabled: false, reason: "Pilot paused" });
  });

  it("offers the drafter a withdrawal, not an approval, with the API's reason in words", () => {
    renderPanel([
      view({
        pendingChange: pending,
        allowedActions: {
          request: false,
          approve: false,
          reject: true,
          approveBlockedReason:
            "You drafted this change; a different administrator must approve it.",
        },
      }),
    ]);
    expect(screen.getByText(/Waiting for approval:/)).toBeInTheDocument();
    expect(screen.getByText(/switch off, drafted by Leo Ramos/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Approve change" })).toBeNull();
    expect(screen.getByRole("button", { name: "Withdraw request" })).toBeInTheDocument();
    expect(
      screen.getByText("You drafted this change; a different administrator must approve it."),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Request switch/ })).toBeNull();
  });

  it("lets a second administrator approve, and shows the API's refusal in the dialog", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          type: "about:blank",
          title: "Conflict",
          status: 409,
          code: "INVALID_STATE_TRANSITION",
          detail: "This change was already rejected.",
        }),
        { status: 409, headers: { "content-type": "application/problem+json" } },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);
    renderPanel([
      view({
        pendingChange: pending,
        allowedActions: { request: false, approve: true, reject: true, approveBlockedReason: null },
      }),
    ]);
    await userEvent.click(screen.getByRole("button", { name: "Approve change" }));
    expect(screen.getByRole("dialog")).toHaveTextContent(/Switch Email and file intake off now\?/);
    await userEvent.click(
      screen.getAllByRole("button", { name: "Approve change" }).at(-1) as HTMLElement,
    );
    await vi.waitFor(() =>
      expect(screen.getByRole("dialog")).toHaveTextContent("This change was already rejected."),
    );
    const [url] = fetchMock.mock.calls[0] as [string];
    expect(url).toBe("/api/features/flags/EMAIL_INTAKE/changes/c1/approve");
  });

  it("shows a refusal about the requested state (a field with no input here) in the dialog", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            type: "about:blank",
            title: "Invalid request",
            status: 400,
            code: "VALIDATION_FAILED",
            detail: "Email and file intake is already off.",
            errors: [{ field: "enabled", message: "Choose the other state." }],
          }),
          { status: 400, headers: { "content-type": "application/problem+json" } },
        ),
      ),
    );
    renderPanel([view({ enabled: false })]);
    expect(screen.getByText("Off")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Request switch on…" }));
    await userEvent.type(screen.getByLabelText("Reason"), "Back on");
    await userEvent.click(screen.getByRole("button", { name: "Draft change" }));
    await vi.waitFor(() =>
      expect(screen.getByRole("dialog")).toHaveTextContent("Choose the other state."),
    );
  });
});
