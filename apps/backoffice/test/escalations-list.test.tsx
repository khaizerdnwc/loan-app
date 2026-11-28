import type { AmlEscalationView } from "@loan/core";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, vi } from "vitest";
import EscalationsPage from "@/app/(staff)/compliance/escalations/page";

// The URL is the filter's state: replace() rewrites it, as the browser would.
const { url, router } = vi.hoisted(() => {
  const url = { search: "" };
  return {
    url,
    router: {
      push: () => {},
      replace: (href: string) => {
        url.search = href.includes("?") ? href.slice(href.indexOf("?")) : "";
      },
    },
  };
});
vi.mock("next/navigation", () => ({
  usePathname: () => "/compliance/escalations",
  useRouter: () => router,
  useSearchParams: () => new URLSearchParams(url.search),
}));
vi.mock("@/lib/session", () => ({
  useSession: () => ({ id: "STF-DIANE", fullName: "Diane Yu", role: "COMPLIANCE" }),
}));

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  url.search = "";
});

const escalation: AmlEscalationView = {
  id: "esc-1",
  caseId: "case-1",
  caseReference: "APP-1007",
  applicantName: "Ramon Cruz",
  stage: "APPLICATION",
  matchedList: "Simulated sanctions list",
  providerMode: "SIMULATED",
  screenedAt: "2026-11-28T01:00:00.000Z",
  status: "OPEN",
  openedAt: "2026-11-28T01:00:00.000Z",
  openedByName: "Decision engine",
  acknowledgedAt: null,
  acknowledgedByName: null,
  closedAt: null,
  closedByName: null,
  outcome: null,
  notes: null,
  priorBookingAttempts: 0,
  effect: "The case was declined at screening.",
} as unknown as AmlEscalationView;

describe("AML escalations list (parity: clickable rows)", () => {
  it("makes each row open its escalation through the name link; the case link stays its own", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify([escalation]), { status: 200 })),
    );
    render(<EscalationsPage />);
    await screen.findByRole("table");
    const row = screen.getAllByRole("row")[1] as HTMLElement;
    expect(row).toHaveAttribute("data-clickable", "true");
    const name = within(row).getByRole("link", { name: "Ramon Cruz" });
    expect(name).toHaveAttribute("data-row-link");
    expect(name).toHaveAttribute("href", "/compliance/escalations/esc-1");
    const caseLink = within(row).getByRole("link", { name: "APP-1007" });
    expect(caseLink).not.toHaveAttribute("data-row-link");
  });

  it("counts Open and All from one list and keeps the choice in the URL", async () => {
    const closed = {
      ...escalation,
      id: "esc-2",
      applicantName: "Dario Mercado",
      caseReference: "APP-1008",
      status: "CLOSED",
    } as AmlEscalationView;
    const acknowledged = {
      ...escalation,
      id: "esc-3",
      applicantName: "Ernesto Lacson",
      caseReference: "APP-1009",
      status: "ACKNOWLEDGED",
    } as AmlEscalationView;
    const fetchMock = vi.fn(
      async () => new Response(JSON.stringify([escalation, closed, acknowledged]), { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const replace = vi.spyOn(router, "replace");
    const { rerender } = render(<EscalationsPage />);
    await screen.findByRole("table");
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/compliance/escalations?view=all",
      expect.anything(),
    );
    const open = screen.getByRole("button", { name: /^Open\s*2$/ });
    expect(open).toHaveAttribute("aria-pressed", "true");
    const names = () =>
      screen
        .getAllByRole("row")
        .slice(1)
        .map((r) => within(r).getAllByRole("link")[0]?.textContent);
    // Open means not closed: open and acknowledged.
    expect(names()).toEqual(["Ramon Cruz", "Ernesto Lacson"]);

    await userEvent.click(screen.getByRole("button", { name: /^All\s*3$/ }));
    expect(replace).toHaveBeenLastCalledWith("/compliance/escalations?view=all", {
      scroll: false,
    });
    rerender(<EscalationsPage />);
    expect(names()).toEqual(["Ramon Cruz", "Dario Mercado", "Ernesto Lacson"]);
    await userEvent.click(screen.getByRole("button", { name: /^Open\s*2$/ }));
    expect(replace).toHaveBeenLastCalledWith("/compliance/escalations", { scroll: false });
  });
});
