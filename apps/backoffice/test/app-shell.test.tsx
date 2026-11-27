import { ToastProvider } from "@loan/ui";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, vi } from "vitest";
import { AppShell, useShellRefresh } from "@/components/app-shell";
import { SessionProvider } from "@/lib/session";

const { router } = vi.hoisted(() => ({ router: { replace: vi.fn(), push: vi.fn() } }));
vi.mock("next/navigation", () => ({ useRouter: () => router, usePathname: () => "/queue" }));

let modes: { service: string; label: string; mode: string }[];
let me: { id: string; fullName: string; role: string };
let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
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

  it("shows the persona and sign-out at the sidebar foot, and a Section / Page breadcrumb", async () => {
    renderShell();
    await screen.findByText("Paolo Tan");
    expect(screen.getByRole("button", { name: "Sign out" })).toBeInTheDocument();
    const crumb = screen.getByRole("navigation", { name: "Breadcrumb" });
    expect(crumb).toHaveTextContent("My work/Work queue");
    expect(screen.getAllByText("Loan officer").length).toBeGreaterThan(0);
    expect(screen.queryByRole("link", { name: /Run simulation/ })).not.toBeInTheDocument();
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
