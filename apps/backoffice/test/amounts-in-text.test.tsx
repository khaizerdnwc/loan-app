/**
 * U-2: amounts the API writes into its sentences read like every other amount. One assertion
 * per place that shows such a sentence (the timeline, refusals and toasts have their own).
 */
import type { CaseDetail, DecisionRecordView } from "@loan/core";
import { ToastProvider } from "@loan/ui";
import { render, screen } from "@testing-library/react";
import { afterEach, vi } from "vitest";
import CasePage from "@/app/(staff)/cases/[id]/page";
import { DecisionPanel } from "@/components/case/decision-panel";

vi.mock("next/navigation", () => ({
  useParams: () => ({ id: "case-1" }),
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  usePathname: () => "/cases/case-1",
}));

afterEach(() => vi.unstubAllGlobals());

const decision = {
  id: "d1",
  caseId: "case-1",
  outcome: "AUTO_APPROVE",
  score: 742,
  grade: "A",
  ruleSetVersion: "RS-PL-1",
  scorecardVersion: "SC-PL-1",
  ruleResults: [
    {
      id: "R07",
      name: "Amount within the automatic approval limit",
      kind: "POLICY",
      result: "PASS",
      value: "limit 300000.00",
    },
  ],
  scoreContributions: [],
  reasonCodes: [],
  referralTriggers: [],
  debtToIncome: "0.1150",
  monthlyRate: "0.0120",
  providerMode: "OK",
  inputs: {},
  inputsHash: "h",
  createdAt: "2026-11-28T01:00:00.000Z",
  automationMode: "LIVE",
  killSwitch: false,
  engineOutcome: "REFER",
} as unknown as DecisionRecordView;

describe("amounts in server-written sentences (U-2)", () => {
  it("formats an amount in a policy rule's value", () => {
    render(<DecisionPanel decision={decision} />);
    expect(screen.getByText("limit ₱300,000.00")).toBeInTheDocument();
    expect(screen.queryByText(/300000\.00/)).toBeNull();
  });

  it("formats an amount in a failed booking's reason on the case page", async () => {
    const detail = {
      id: "case-1",
      reference: "APP-1003",
      productCode: "PL",
      requestedAmount: "150000.00",
      requestedTenorMonths: 24,
      status: "BOOKING_FAILED",
      outcome: null,
      grade: null,
      escalated: false,
      createdAt: "2026-11-28T01:00:00.000Z",
      updatedAt: "2026-11-28T01:00:00.000Z",
      applicant: {
        id: "app-maria",
        fullName: "Maria Santos",
        ageYears: 31,
        employer: "Synthetic Co.",
        employmentMonths: 30,
        relationshipMonths: 18,
        monthlyIncome: "78000.00",
        monthlyObligations: "9000.00",
        depositAccount: "WB-SAV-0001",
        governmentIdMasked: "••••-0001",
      },
      purpose: "Tuition",
      decision: null,
      recommendation: null,
      approved: null,
      decline: null,
      withdrawal: null,
      closedFrom: null,
      expiresAt: null,
      consent: null,
      booking: {
        status: "FAILED",
        makerName: "Marco Bautista",
        attempts: 1,
        idempotencyKey: "bk-1",
        lastErrorCode: "CORE_TIMEOUT",
        lastErrorDetail: "Core banking did not confirm ₱150000.00 in time.",
      },
      loanAccountId: null,
      documents: [],
      infoRequest: null,
      allowedActions: [],
    } as unknown as CaseDetail;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) =>
        url === "/api/cases/case-1"
          ? new Response(JSON.stringify(detail), { status: 200 })
          : new Response("[]", { status: 200 }),
      ),
    );
    render(
      <ToastProvider>
        <CasePage />
      </ToastProvider>,
    );
    expect(
      await screen.findByText(/Core banking did not confirm ₱150,000\.00 in time\./),
    ).toBeInTheDocument();
    expect(screen.queryByText(/150000\.00/)).toBeNull();

    // U-6: the case header's own crumb uses the top bar's wording and only shows below
    // 860px, where the top bar's crumb is hidden (one breadcrumb at any width).
    const crumb = screen.getByRole("link", { name: "All applications" }).closest("p");
    expect(crumb).toHaveAttribute("data-crumb", "case-header");
    expect(crumb).toHaveTextContent("All applications / APP-1003");
    expect(crumb?.className).toMatch(/min-\[860px\]:hidden/);
  });
});
