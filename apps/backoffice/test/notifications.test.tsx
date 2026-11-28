import type { BorrowerMessageView, StaffNotificationList, StaffNotificationView } from "@loan/core";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, vi } from "vitest";
import NotificationsPage from "@/app/(staff)/notifications/page";
import { BorrowerMessages } from "@/components/case/borrower-messages";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: () => {}, replace: () => {} }),
  usePathname: () => "/notifications",
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock("@/lib/session", () => ({
  useSession: () => ({ id: "STF-RINA", fullName: "Rina Bautista", role: "APPROVER" }),
}));

afterEach(() => vi.unstubAllGlobals());

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": status >= 400 ? "application/problem+json" : "application/json" },
  });

const alert = (patch: Partial<StaffNotificationView> = {}): StaffNotificationView => ({
  id: "n-1",
  kind: "APPROVAL_WAITING",
  title: "APP-1007 is waiting for your approval",
  caseId: "case-1",
  caseReference: "APP-1007",
  forRole: "APPROVER",
  createdAt: "2026-12-01T01:00:00.000Z",
  readAt: null,
  readByName: null,
  ...patch,
});

const message = (patch: Partial<BorrowerMessageView> = {}): BorrowerMessageView => ({
  id: "m-1",
  channel: "EMAIL",
  template: "UNDER_REVIEW",
  recipient: "Applicant, email on file",
  subject: "Your WhiteBank loan application is being reviewed",
  body: "Your application APP-1007 needs a review by our credit team.",
  status: "SENT",
  attempts: 1,
  providerReference: "MSG-00000001",
  providerMode: "SIMULATED",
  lastError: null,
  createdAt: "2026-12-01T01:00:00.000Z",
  sentAt: "2026-12-01T01:00:30.000Z",
  ...patch,
});

describe("staff notifications page (NTF-2)", () => {
  it("lists alerts with who they are for, a case link and a past-SLA mark; marking a role alert read says it is for the role", async () => {
    const list: StaffNotificationList = {
      items: [
        alert(),
        alert({
          id: "n-2",
          kind: "SLA_BREACHED",
          title: "APP-1008 is past its SLA (In review)",
          caseId: "case-2",
          caseReference: "APP-1008",
          forRole: null,
          readAt: "2026-12-01T02:00:00.000Z",
        }),
      ],
      unread: 1,
    };
    const fetchMock = vi.fn(async (url: string) =>
      url.endsWith("/read")
        ? json(alert({ readAt: "2026-12-01T03:00:00.000Z", readByName: "Rina Aquino" }))
        : json(list),
    );
    vi.stubGlobal("fetch", fetchMock);
    render(<NotificationsPage />);
    const items = within(await screen.findByRole("list", { name: "Alerts" })).getAllByRole(
      "listitem",
    );
    expect(screen.getByText("1 unread")).toBeInTheDocument();
    expect(items[0]).toHaveTextContent("New");
    expect(items[0]).toHaveTextContent("for everyone in your role");
    expect(within(items[0] as HTMLElement).getByRole("link", { name: "APP-1007" })).toHaveAttribute(
      "href",
      "/cases/case-1",
    );
    expect(items[1]).toHaveTextContent("Past SLA");
    expect(items[1]).toHaveTextContent("for you");
    // A read alert has no button.
    expect(within(items[1] as HTMLElement).queryByRole("button")).toBeNull();

    await userEvent.click(
      within(items[0] as HTMLElement).getByRole("button", {
        name: 'Mark "APP-1007 is waiting for your approval" read for your role',
      }),
    );
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/notifications/n-1/read",
      expect.objectContaining({ method: "POST" }),
    );
    expect(await screen.findByText("0 unread")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Mark/ })).toBeNull();
    // Everyone in the role can see who picked it up, and when.
    expect(screen.getAllByRole("listitem")[0]).toHaveTextContent(/read by Rina Aquino/);
  });

  it("an alert for one person says plain Mark read; a read role alert names who read it", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        json({
          items: [
            alert({
              id: "n-3",
              kind: "ASSIGNED",
              title: "APP-1009 was reassigned to you",
              forRole: null,
            }),
            alert({ id: "n-4", readAt: "2026-12-01T02:00:00.000Z", readByName: "Ben Castro" }),
          ],
          unread: 1,
        }),
      ),
    );
    render(<NotificationsPage />);
    const [mine, read] = within(await screen.findByRole("list", { name: "Alerts" })).getAllByRole(
      "listitem",
    );
    expect(
      within(mine as HTMLElement).getByRole("button", {
        name: 'Mark "APP-1009 was reassigned to you" read',
      }),
    ).toHaveTextContent(/^Mark read$/);
    expect(mine).not.toHaveTextContent("read by");
    expect(read).toHaveTextContent(/read by Ben Castro/);
  });

  it("says so when there are no alerts, and shows a refused mark-read readably", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => json({ items: [], unread: 0 })),
    );
    const { unmount } = render(<NotificationsPage />);
    expect(await screen.findByText("No alerts for you yet.")).toBeInTheDocument();
    unmount();

    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) =>
        url.endsWith("/read")
          ? json(
              { title: "Not found", status: 404, detail: "The notification was not found." },
              404,
            )
          : json({ items: [alert()], unread: 1 }),
      ),
    );
    render(<NotificationsPage />);
    await userEvent.click(await screen.findByRole("button", { name: /Mark/ }));
    expect(await screen.findByRole("alert")).toHaveTextContent("The notification was not found.");
  });
});

describe("messages to the borrower on the case (NTF-1, NTF-3)", () => {
  it("labels the gateway simulated and shows each message's channel, status and reference", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => json([message()])),
    );
    render(<BorrowerMessages caseId="case-1" version={1} />);
    const [line] = within(
      await screen.findByRole("list", { name: "Messages to the borrower" }),
    ).getAllByRole("listitem");
    expect(screen.getByText(/Simulated/)).toBeInTheDocument();
    expect(line).toHaveTextContent("Sent");
    expect(line).toHaveTextContent("Email · Applicant, email on file");
    expect(line).toHaveTextContent("MSG-00000001");
    expect(line).not.toHaveTextContent("attempts");
  });

  it("a message the gateway could not take says why and that the case does not wait for it", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        json([
          message({
            id: "m-2",
            channel: "SMS",
            status: "PENDING",
            attempts: 2,
            providerReference: null,
            sentAt: null,
            lastError: "The email/SMS gateway (simulated) was unavailable.",
          }),
          message({
            id: "m-3",
            status: "FAILED",
            attempts: 5,
            providerReference: null,
            sentAt: null,
            lastError: "The email/SMS gateway (simulated) did not answer in time.",
          }),
        ]),
      ),
    );
    render(<BorrowerMessages caseId="case-1" version={1} />);
    const [waiting, failed] = within(
      await screen.findByRole("list", { name: "Messages to the borrower" }),
    ).getAllByRole("listitem");
    expect(waiting).toHaveTextContent("Waiting to send");
    expect(waiting).toHaveTextContent("SMS");
    expect(waiting).toHaveTextContent("2 attempts");
    expect(waiting).toHaveTextContent("the case does not wait for it");
    expect(failed).toHaveTextContent("Not sent");
    expect(failed).toHaveTextContent(
      "Not sent after 5 attempts. No more attempts will be made and the case is not affected; contact the borrower another way if they need this.",
    );
  });

  it("a message given up on after an unexpected error says why once, and only the status line says what happens next", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        json([
          message({
            id: "m-4",
            status: "FAILED",
            attempts: 5,
            providerReference: null,
            sentAt: null,
            lastError:
              "The message could not be handed to the email/SMS gateway (simulated) because of an unexpected error.",
          }),
        ]),
      ),
    );
    render(<BorrowerMessages caseId="case-1" version={1} />);
    const [line] = within(
      await screen.findByRole("list", { name: "Messages to the borrower" }),
    ).getAllByRole("listitem");
    expect(line).toHaveTextContent("because of an unexpected error.");
    expect(line).toHaveTextContent("No more attempts will be made");
    expect(line).not.toHaveTextContent("tried again");
  });

  it("says so when nothing has been sent yet", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => json([])),
    );
    render(<BorrowerMessages caseId="case-1" version={1} />);
    expect(await screen.findByText("No messages to the borrower yet.")).toBeInTheDocument();
  });
});
