import { ToastProvider } from "@loan/ui";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Component, type ReactNode } from "react";
import { afterEach, beforeEach, vi } from "vitest";
import { AppShell, useShellCrumb, useShellRefresh } from "@/components/app-shell";
import { SessionProvider } from "@/lib/session";

const { router, location } = vi.hoisted(() => ({
  router: { replace: vi.fn(), push: vi.fn() },
  location: { pathname: "/queue" },
}));
vi.mock("next/navigation", () => ({
  useRouter: () => router,
  usePathname: () => location.pathname,
}));

let modes: { service: string; label: string; mode: string }[];
let me: { id: string; fullName: string; role: string };
let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  location.pathname = "/queue";
  modes = [{ service: "CREDIT_BUREAU", label: "Credit bureau", mode: "OK" }];
  me = { id: "STF-PAOLO", fullName: "Paolo Tan", role: "LOAN_OFFICER" };
  // The drawer behaviour applies under 860px.
  vi.stubGlobal("matchMedia", () => ({
    matches: true,
    addEventListener: () => {},
    removeEventListener: () => {},
  }));
  fetchMock = vi.fn(async (url: string) => {
    const body = url.endsWith("/auth/me")
      ? me
      : url.includes("/simulation/services")
        ? modes
        : { items: [] };
    return new Response(JSON.stringify(body), { status: 200 });
  });
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

function RefreshButton() {
  const refresh = useShellRefresh();
  return (
    <button type="button" onClick={refresh}>
      Do something
    </button>
  );
}

function CasePageStandIn({ reference }: { reference: string | null }) {
  useShellCrumb(reference);
  return <p>Case page</p>;
}

/** Turns a render-time or effect error into visible text, so a test fails instead of erroring. */
class Boundary extends Component<{ children: ReactNode }, { error: string | null }> {
  override state = { error: null as string | null };
  static getDerivedStateFromError(e: unknown) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
  override render() {
    return this.state.error ? <p>Crashed: {this.state.error}</p> : this.props.children;
  }
}

const renderShell = () =>
  render(
    <ToastProvider>
      <SessionProvider fallback={<p>Checking…</p>}>
        <AppShell>
          <RefreshButton />
        </AppShell>
      </SessionProvider>
    </ToastProvider>,
  );

describe("AppShell", () => {
  it("refreshes the failure banner when a screen asks, without navigating", async () => {
    renderShell();
    await screen.findByText("Paolo Tan");
    expect(screen.queryByText(/Simulated failure active/)).not.toBeInTheDocument();
    modes = [{ service: "CREDIT_BUREAU", label: "Credit bureau", mode: "OUTAGE" }];
    await userEvent.click(screen.getByRole("button", { name: "Do something" }));
    await screen.findByText(/Simulated failure active/);
    expect(screen.getByRole("status")).toHaveTextContent("Credit bureau — outage");
  });

  it("shows the unread alert count on Notifications, and refreshes it when a screen asks (NTF-2)", async () => {
    let unread = 2;
    const base = fetchMock.getMockImplementation() as (url: string) => Promise<Response>;
    fetchMock.mockImplementation(async (url: string) =>
      url.includes("/notifications")
        ? new Response(JSON.stringify({ items: [], unread }), { status: 200 })
        : base(url),
    );
    renderShell();
    // The sidebar is a closed drawer at this width (inert), hence hidden: true.
    const link = (await screen.findAllByRole("link", { hidden: true })).find(
      (l) => l.getAttribute("href") === "/notifications",
    ) as HTMLElement;
    // The badge reads "2 unread" to a screen reader (visually "2").
    expect(await within(link).findByTestId("unread-badge")).toHaveTextContent("2 unread");
    unread = 0;
    await userEvent.click(screen.getByRole("button", { name: "Do something" }));
    await vi.waitFor(() => expect(within(link).queryByTestId("unread-badge")).toBeNull());
    expect(link).toHaveAccessibleName("Notifications");
  });

  it("shows the persona and sign-out at the sidebar foot, and a Section / Page breadcrumb", async () => {
    renderShell();
    await screen.findByText("Paolo Tan");
    expect(screen.getByRole("button", { name: "Sign out" })).toBeInTheDocument();
    const crumb = screen.getByRole("navigation", { name: "Breadcrumb" });
    expect(crumb).toHaveTextContent("My work/Work queue");
    expect(screen.getAllByText("Loan officer").length).toBeGreaterThan(0);
    expect(screen.queryByRole("link", { name: /Run simulation/ })).not.toBeInTheDocument();
  });

  it("on a case, names the section, links back to All applications and ends with the reference", async () => {
    location.pathname = "/cases/case-1";
    const { rerender } = render(
      <ToastProvider>
        <SessionProvider fallback={<p>Checking…</p>}>
          <AppShell>
            <CasePageStandIn reference={null} />
          </AppShell>
        </SessionProvider>
      </ToastProvider>,
    );
    await screen.findByText("Case page");
    const crumb = screen.getByRole("navigation", { name: "Breadcrumb" });
    // Until the case has loaded, the last part says "Case".
    expect(crumb).toHaveTextContent(/\/All applications\/Case$/);
    expect(within(crumb).getByRole("link", { name: "All applications" })).toHaveAttribute(
      "href",
      "/cases",
    );
    rerender(
      <ToastProvider>
        <SessionProvider fallback={<p>Checking…</p>}>
          <AppShell>
            <CasePageStandIn reference="APP-1002" />
          </AppShell>
        </SessionProvider>
      </ToastProvider>,
    );
    expect(within(crumb).getByText("APP-1002")).toHaveAttribute("aria-current", "page");
  });

  it("on another detail page (an AML escalation), links back to its list and ends with the record", async () => {
    me = { id: "STF-DIANE", fullName: "Diane Yu", role: "COMPLIANCE" };
    location.pathname = "/compliance/escalations/esc-1";
    render(
      <ToastProvider>
        <SessionProvider fallback={<p>Checking…</p>}>
          <AppShell>
            <CasePageStandIn reference="APP-1007" />
          </AppShell>
        </SessionProvider>
      </ToastProvider>,
    );
    await screen.findByText("Case page");
    const crumb = screen.getByRole("navigation", { name: "Breadcrumb" });
    // The page names its record from an effect, so the last part arrives a moment later.
    expect(await within(crumb).findByText("APP-1007")).toHaveAttribute("aria-current", "page");
    expect(crumb).toHaveTextContent("Compliance/AML escalations/APP-1007");
    expect(within(crumb).getByRole("link", { name: "AML escalations" })).toHaveAttribute(
      "href",
      "/compliance/escalations",
    );
  });

  it("keeps a page with its own nav item (New application) as Section / Page", async () => {
    location.pathname = "/cases/new";
    renderShell();
    await screen.findByText("Paolo Tan");
    const crumb = screen.getByRole("navigation", { name: "Breadcrumb" });
    expect(within(crumb).queryByRole("link")).toBeNull();
    expect(crumb).toHaveTextContent(/New application$/);
  });

  it("renders where matchMedia is unavailable, treating the screen as wide (sidebar not inert)", async () => {
    vi.stubGlobal("matchMedia", undefined);
    const quiet = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      render(
        <Boundary>
          <ToastProvider>
            <SessionProvider fallback={<p>Checking…</p>}>
              <AppShell>
                <RefreshButton />
              </AppShell>
            </SessionProvider>
          </ToastProvider>
        </Boundary>,
      );
      expect(await screen.findByText("Paolo Tan")).toBeInTheDocument();
      expect(screen.queryByText(/Crashed/)).not.toBeInTheDocument();
      expect(screen.getByRole("navigation", { name: "Main" }).closest("aside")).not.toHaveAttribute(
        "inert",
      );
    } finally {
      quiet.mockRestore();
    }
    expect(screen.getByRole("navigation", { name: "Breadcrumb" })).toBeInTheDocument();
  });

  it("gives the admin a Run simulation link to the simulation screen", async () => {
    me = { id: "STF-LEO", fullName: "Leo Santiago", role: "ADMIN" };
    renderShell();
    await screen.findByText("Leo Santiago");
    expect(screen.getByRole("link", { name: "Run simulation" })).toHaveAttribute(
      "href",
      "/simulation",
    );
  });

  it("returns focus to the Menu button when the drawer closes by Escape or the backdrop", async () => {
    renderShell();
    const menu = await screen.findByRole("button", { name: "Menu" });
    await userEvent.click(menu);
    expect(screen.getByRole("link", { name: /Work queue/ })).toHaveFocus();
    await userEvent.keyboard("{Escape}");
    expect(menu).toHaveFocus();
    expect(menu).toHaveAttribute("aria-expanded", "false");

    await userEvent.click(menu);
    await userEvent.click(screen.getByRole("button", { name: "Close menu" }));
    expect(menu).toHaveFocus();
  });
});
