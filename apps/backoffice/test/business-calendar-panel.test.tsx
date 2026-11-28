import type { BusinessCalendarView, HolidayChangeView } from "@loan/core";
import { ToastProvider } from "@loan/ui";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, vi } from "vitest";
import { BusinessCalendarPanel } from "@/components/calendar/business-calendar-panel";

afterEach(() => vi.unstubAllGlobals());

const calendar = (patch: Partial<BusinessCalendarView> = {}): BusinessCalendarView => ({
  today: "2026-12-01",
  holidays: [
    { date: "2026-11-30", name: "Bonifacio Day" },
    { date: "2026-12-08", name: "Feast of the Immaculate Conception" },
    { date: "2026-12-25", name: "Christmas Day" },
  ],
  pending: [],
  ...patch,
});

const change = (patch: Partial<HolidayChangeView> = {}): HolidayChangeView => ({
  id: "c1",
  action: "ADD",
  date: "2026-12-28",
  name: "Typhoon suspension",
  reason: "Declared by the Palace",
  requestedByName: "Leo Ramos",
  requestedAt: "2026-12-01T02:00:00.000Z",
  allowedActions: { approve: true, reject: true, approveBlockedReason: null },
  ...patch,
});

const problem = (status: number, body: object) =>
  new Response(JSON.stringify({ type: "about:blank", title: "Refused", status, ...body }), {
    status,
    headers: { "content-type": "application/problem+json" },
  });

const renderPanel = (view: BusinessCalendarView, onChanged = vi.fn()) =>
  render(
    <ToastProvider>
      <BusinessCalendarPanel view={view} onChanged={onChanged} />
    </ToastProvider>,
  );

describe("BusinessCalendarPanel (HC-7, PRD PLT-005)", () => {
  it("lists only the holidays after today, says the earlier ones stay as measured", () => {
    renderPanel(calendar());
    const ahead = screen.getByRole("region", { name: "Holidays ahead" });
    expect(within(ahead).getByText("Christmas Day")).toBeInTheDocument();
    expect(within(ahead).queryByText("Bonifacio Day")).not.toBeInTheDocument();
    expect(ahead).toHaveTextContent("1 earlier day stays as measured and cannot change.");
    expect(
      within(ahead).getByRole("button", {
        name: /Request removal of Christmas Day/,
      }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Waiting for approval" })).not.toBeInTheDocument();
  });

  it("with no holidays ahead, says so and still explains business time and the earlier days", () => {
    renderPanel(calendar({ holidays: [{ date: "2026-11-30", name: "Bonifacio Day" }] }));
    const ahead = screen.getByRole("region", { name: "Holidays ahead" });
    expect(ahead).toHaveTextContent("No holidays after today.");
    expect(ahead).toHaveTextContent("Business time is Monday to Friday, 09:00–17:00 Manila");
    expect(ahead).toHaveTextContent("1 earlier day stays as measured and cannot change.");
    expect(within(ahead).getByRole("button", { name: "Request a holiday…" })).toBeInTheDocument();
  });

  it("drafts a holiday only with a date, a name and a reason, after a confirmation that says nothing changes yet", async () => {
    const drafted = calendar({ pending: [change()] });
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify(drafted), { status: 201 }));
    vi.stubGlobal("fetch", fetchMock);
    const onChanged = vi.fn();
    renderPanel(calendar(), onChanged);

    await userEvent.click(screen.getByRole("button", { name: "Request a holiday…" }));
    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveTextContent(/Nothing changes until a second administrator approves it/);
    expect(within(dialog).getByLabelText("Date")).toHaveAttribute("min", "2026-12-02");
    await userEvent.click(within(dialog).getByRole("button", { name: "Draft change" }));
    expect(dialog).toHaveTextContent("Choose a date.");
    expect(dialog).toHaveTextContent("Enter a name.");
    expect(dialog).toHaveTextContent("Enter a reason.");
    expect(fetchMock).not.toHaveBeenCalled();

    await userEvent.type(within(dialog).getByLabelText("Date"), "2026-12-28");
    await userEvent.type(within(dialog).getByLabelText("Name"), "Typhoon suspension");
    await userEvent.type(within(dialog).getByLabelText("Reason"), "Declared by the Palace");
    await userEvent.click(within(dialog).getByRole("button", { name: "Draft change" }));
    await vi.waitFor(() => expect(onChanged).toHaveBeenCalledWith(drafted));
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/calendar/changes");
    expect(JSON.parse(init.body as string)).toEqual({
      action: "ADD",
      date: "2026-12-28",
      name: "Typhoon suspension",
      reason: "Declared by the Palace",
    });
  });

  it("shows a date refusal on a removal (no date input there) in the dialog's error", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValueOnce(
        problem(400, {
          code: "VALIDATION_FAILED",
          detail: "Only days after today can change.",
          errors: [{ field: "date", message: "Past and current days were already measured." }],
        }),
      ),
    );
    renderPanel(calendar());
    await userEvent.click(screen.getByRole("button", { name: /Request removal of Christmas Day/ }));
    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveTextContent(/Ask to remove Christmas Day/);
    await userEvent.type(within(dialog).getByLabelText("Reason"), "Moved");
    await userEvent.click(within(dialog).getByRole("button", { name: "Draft change" }));
    await vi.waitFor(() =>
      expect(dialog).toHaveTextContent("Past and current days were already measured."),
    );
  });

  it("offers the drafter a withdrawal, not an approval, and marks the day as waiting", () => {
    renderPanel(
      calendar({
        pending: [
          change({
            action: "REMOVE",
            date: "2026-12-25",
            name: "Christmas Day",
            allowedActions: {
              approve: false,
              reject: true,
              approveBlockedReason:
                "You drafted this change; a different administrator must approve it.",
            },
          }),
        ],
      }),
    );
    const waiting = screen.getByRole("region", { name: "Waiting for approval" });
    expect(waiting).toHaveTextContent("Remove a holiday:");
    expect(within(waiting).queryByRole("button", { name: "Approve change" })).toBeNull();
    expect(within(waiting).getByRole("button", { name: "Withdraw request" })).toBeInTheDocument();
    expect(waiting).toHaveTextContent("a different administrator must approve it");
    const ahead = screen.getByRole("region", { name: "Holidays ahead" });
    expect(within(ahead).getByText("Change waiting")).toBeInTheDocument();
  });

  it("lets a second administrator approve, and shows the API's refusal in the dialog", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(
      problem(409, {
        code: "INVALID_STATE_TRANSITION",
        detail: "28 Dec 2026 is already a holiday (Local fiesta). Reject this request instead.",
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    renderPanel(calendar({ pending: [change()] }));
    await userEvent.click(screen.getByRole("button", { name: "Approve change" }));
    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveTextContent(/a holiday now\?/);
    await userEvent.click(within(dialog).getByRole("button", { name: "Approve change" }));
    await vi.waitFor(() => expect(dialog).toHaveTextContent("Reject this request instead."));
    const [url] = fetchMock.mock.calls[0] as [string];
    expect(url).toBe("/api/calendar/changes/c1/approve");
  });
});
