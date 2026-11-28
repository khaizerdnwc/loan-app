/**
 * U-14: Email and file intake, its review dialog and the eligibility pre-check follow the shared
 * parts (docs/ui-parity.md rows 73–80).
 */
import type { EligibilityPreCheckView, IntakeDraftView, StaffView } from "@loan/core";
import { ToastProvider } from "@loan/ui";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, vi } from "vitest";
import IntakePage from "@/app/(staff)/intake/page";
import { PreCheckForm } from "@/components/eligibility/pre-check-form";

const { url, router, session } = vi.hoisted(() => {
  const url = { search: "?view=all" };
  return {
    url,
    session: { me: { id: "STF-PAOLO", fullName: "Paolo Tan", role: "LOAN_OFFICER" } },
    router: {
      push: (_href: string) => {},
      replace: (href: string) => {
        url.search = href.includes("?") ? href.slice(href.indexOf("?")) : "";
      },
    },
  };
});
vi.mock("next/navigation", () => ({
  usePathname: () => "/intake",
  useRouter: () => router,
  useSearchParams: () => new URLSearchParams(url.search),
}));
vi.mock("@/lib/session", () => ({ useSession: () => session.me as StaffView }));

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  url.search = "?view=all";
});

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

function draft(name: string, patch: Partial<IntakeDraftView> = {}): IntakeDraftView {
  return {
    id: `d-${name}`,
    batchReference: "OCR-B-1A2B3C4D",
    source: "PARTNER_SPREADSHEET",
    fileName: "Cordillera Foods HR – salary loan requests Nov 2026.xlsx",
    rowNumber: 2,
    sourceDetail: "Partner spreadsheet, row 2",
    extracted: {
      fullName: name,
      birthDate: "1997-02-14",
      governmentIdLast4: "5521",
      employer: "Cordillera Foods Inc.",
      declaredMonthlyIncome: "32000.00",
      documentMonthlyIncome: null,
      amount: "50000.00",
      tenorMonths: 12,
      purpose: "Tuition",
    },
    matchedApplicant: { id: "APL-X", fullName: name },
    flags: [],
    status: "PENDING_REVIEW",
    providerMode: "SIMULATED",
    uploadedByName: "Paolo Tan",
    uploadedAt: "2026-11-28T01:00:00.000Z",
    case: null,
    review: null,
    actions: ["CONFIRM", "DISCARD"],
    ...patch,
  } as IntakeDraftView;
}

const pending = draft("Ramil Ocampo");
const confirmed = draft("Grace Villamor", {
  id: "d-grace",
  status: "CONFIRMED",
  actions: [],
  case: { id: "case-9", reference: "APP-1009" },
});

const page = () =>
  render(
    <ToastProvider>
      <IntakePage />
    </ToastProvider>,
  );

describe("intake drafts table (rows 73–74)", () => {
  it("sits in the card with one border, and a confirmed draft opens its case from the whole row", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => json([pending, confirmed])),
    );
    page();
    const table = await screen.findByRole("table", { name: "Intake drafts" });
    // The card is the frame: the table draws no border of its own.
    expect(table.parentElement).not.toHaveAttribute("data-framed");
    const [, pendingRow, confirmedRow] = screen.getAllByRole("row") as HTMLElement[];
    expect(pendingRow).not.toHaveAttribute("data-clickable");
    expect(confirmedRow).toHaveAttribute("data-clickable", "true");
    expect(
      within(confirmedRow as HTMLElement).getByRole("link", { name: "APP-1009" }),
    ).toHaveAttribute("data-row-link");
  });
});

describe("review dialog (row 75)", () => {
  it("says it is working while the draft is created", async () => {
    let release: (r: Response) => void = () => {};
    vi.stubGlobal(
      "fetch",
      vi.fn((input: RequestInfo | URL) =>
        String(input).endsWith("/confirm")
          ? new Promise<Response>((resolve) => {
              release = resolve;
            })
          : Promise.resolve(json([pending])),
      ),
    );
    page();
    await userEvent.click(
      await screen.findByRole("button", { name: "Review draft: Ramil Ocampo" }),
    );
    const dialog = screen.getByRole("dialog");
    await userEvent.click(within(dialog).getByRole("button", { name: "Create application draft" }));
    const working = within(dialog).getByRole("button", { name: "Working…" });
    expect(working).toBeDisabled();
    expect(working).toHaveAttribute("aria-busy", "true");
    release(json({ ...pending, status: "CONFIRMED", case: { id: "c", reference: "APP-1" } }));
  });
});

describe("eligibility pre-check (rows 77–79)", () => {
  const result: EligibilityPreCheckView = {
    productCode: "PL",
    ruleSetVersion: "RS-X",
    outcome: "REVIEW_LIKELY",
    checks: [{ id: "PC-AGE", name: "Applicant age 21–65", result: "PASS", value: "age 35" }],
    monthlyRateRange: { from: "0.0120", to: "0.0200" },
    affordable: { atBestRate: "91000.00", atWorstRate: "79000.00" },
    caveat: "Indicative only, from the figures given: not a decision or an offer.",
  };

  it("before a check, the result card is the shared empty state", () => {
    render(<PreCheckForm />);
    expect(screen.getByText("No check yet").className).toMatch(/font-bold/);
  });

  it("shows the ranges as label-over-value facts and the rule-set version as an identifier", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(json(result)));
    render(<PreCheckForm />);
    await userEvent.type(screen.getByLabelText("Amount (pesos)"), "250000");
    await userEvent.type(screen.getByLabelText("Tenor (months)"), "24");
    await userEvent.type(screen.getByLabelText("Age (years)"), "35");
    await userEvent.type(screen.getByLabelText("Monthly income (pesos)"), "70000");
    await userEvent.click(screen.getByRole("button", { name: "Check eligibility" }));
    const rate = await screen.findByText("Monthly rate, by grade");
    expect(rate.tagName).toBe("DT");
    expect(rate.parentElement).toHaveTextContent(/1\.20% \/ month to 2\.00% \/ month/);
    expect(
      screen.getByText("Affordable amount (engine), best grade rate").parentElement,
    ).toHaveTextContent("₱91,000.00");
    expect(screen.getByText("RS-X").className).toMatch(/font-mono/);
  });
});
