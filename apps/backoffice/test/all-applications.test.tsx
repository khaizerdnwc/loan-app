import { CASE_STATUSES, type CaseStatus, type CaseSummary, CLOSED_CASE_STATUSES } from "@loan/core";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, vi } from "vitest";
import AllCasesPage from "@/app/(staff)/cases/page";
import { inScope, parseScope } from "@/components/case-scope";

// The URL is the filter's state: replace() rewrites it, as the browser would.
const { me, url, router } = vi.hoisted(() => {
  const url = { search: "" };
  return {
    me: { role: "LOAN_OFFICER" as string },
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
  usePathname: () => "/cases",
  useRouter: () => router,
  useSearchParams: () => new URLSearchParams(url.search),
}));
vi.mock("@/lib/session", () => ({
  useSession: () => ({ id: "STF-1", fullName: "Paolo Tan", role: me.role }),
}));

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  me.role = "LOAN_OFFICER";
  url.search = "";
});

const summary = (id: string, status: CaseStatus, name: string): CaseSummary => ({
  id,
  reference: `APP-${id}`,
  applicantName: name,
  productCode: "PL",
  requestedAmount: "100000.00",
  requestedTenorMonths: 12,
  status,
  outcome: null,
  reason: null,
  reasonCount: 0,
  grade: null,
  escalated: false,
  createdAt: "2026-11-28T01:00:00.000Z",
  updatedAt: "2026-11-28T01:00:00.000Z",
});

const mixed = [
  summary("1", "REVIEW", "Joel Reyes"),
  summary("2", "DISBURSED", "Maria Santos"),
  summary("3", "WITHDRAWN", "Rosa Santos"),
  summary("4", "DRAFT", "Liza Ramos"),
];

function stubList(items: CaseSummary[]) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(JSON.stringify({ items }), { status: 200 })),
  );
}

const names = () =>
  screen
    .getAllByRole("row")
    .slice(1)
    .map((r) => within(r).getByRole("link").textContent);

const scopeButton = (label: string, count: number) =>
  screen.getByRole("button", { name: new RegExp(`^${label}\\s*${count}$`) });

describe("All applications scopes (U-5)", () => {
  it.each(
    CASE_STATUSES.map((s) => [s, CLOSED_CASE_STATUSES.includes(s) ? "closed" : "open"] as const),
  )("%s is %s", (status, scope) => {
    expect(inScope(status, scope)).toBe(true);
    expect(inScope(status, scope === "open" ? "closed" : "open")).toBe(false);
    expect(inScope(status, "all")).toBe(true);
  });

  it.each([
    [null, "open"],
    ["closed", "closed"],
    ["all", "all"],
    ["anything", "open"],
  ] as const)("reads ?scope=%s as %s", (value, scope) => {
    expect(parseScope(value)).toBe(scope);
  });
});

describe("All applications screen (U-5)", () => {
  it("opens on In progress, with counts for In progress, Closed and All", async () => {
    stubList(mixed);
    render(<AllCasesPage />);
    await screen.findByRole("table");
    expect(names()).toEqual(["Joel Reyes", "Liza Ramos"]);
    expect(scopeButton("In progress", 2)).toHaveAttribute("aria-pressed", "true");
    expect(scopeButton("Closed", 2)).toBeInTheDocument();
    expect(scopeButton("All", 4)).toBeInTheDocument();
  });

  it("keeps the choice in the URL, so Back from a case restores it", async () => {
    stubList(mixed);
    const replace = vi.spyOn(router, "replace");
    const { rerender } = render(<AllCasesPage />);
    await screen.findByRole("table");
    await userEvent.click(scopeButton("Closed", 2));
    expect(replace).toHaveBeenLastCalledWith("/cases?scope=closed", { scroll: false });
    rerender(<AllCasesPage />);
    expect(names()).toEqual(["Maria Santos", "Rosa Santos"]);
    await userEvent.click(scopeButton("All", 4));
    expect(replace).toHaveBeenLastCalledWith("/cases?scope=all", { scroll: false });
    rerender(<AllCasesPage />);
    expect(names()).toHaveLength(4);
    await userEvent.click(scopeButton("In progress", 2));
    expect(replace).toHaveBeenLastCalledWith("/cases", { scroll: false });
  });

  it("opens on the scope the URL names (coming Back to ?scope=closed)", async () => {
    url.search = "?scope=closed";
    stubList(mixed);
    render(<AllCasesPage />);
    await screen.findByRole("table");
    expect(scopeButton("Closed", 2)).toHaveAttribute("aria-pressed", "true");
    expect(names()).toEqual(["Maria Santos", "Rosa Santos"]);
  });

  it.each([
    ["", [summary("2", "DISBURSED", "Maria Santos")], "No applications in progress."],
    ["?scope=closed", [summary("1", "REVIEW", "Joel Reyes")], "No closed applications yet."],
    ["?scope=all", [], "No applications yet."],
  ])("with nothing in scope %s it says so: %s", async (search, items, sentence) => {
    url.search = search;
    stubList(items);
    render(<AllCasesPage />);
    expect(await screen.findByText(sentence)).toBeInTheDocument();
    expect(screen.queryByRole("table")).toBeNull();
  });

  it("offers New application to a loan officer only", async () => {
    stubList(mixed);
    const { unmount } = render(<AllCasesPage />);
    await screen.findByRole("table");
    expect(screen.getByRole("link", { name: "New application" })).toHaveAttribute(
      "href",
      "/cases/new",
    );
    unmount();
    for (const role of ["APPROVER", "LOAN_OPERATIONS", "COMPLIANCE"]) {
      me.role = role;
      const view = render(<AllCasesPage />);
      await screen.findByRole("table");
      expect(screen.queryByRole("link", { name: "New application" })).toBeNull();
      view.unmount();
    }
  });
});
