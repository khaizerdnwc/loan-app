import type { ApprovalLevelView, CaseDetail } from "@loan/core";
import { ToastProvider } from "@loan/ui";
import { render, screen, within } from "@testing-library/react";
import { vi } from "vitest";
import { ShellRefresh } from "@/components/app-shell";
import { ApprovalMatrixTable, gradeRange } from "@/components/approval-matrix-table";
import { ActionsPanel } from "@/components/case/actions-panel";
import { navFor } from "@/lib/navigation";

const LEVELS: ApprovalLevelView[] = [
  {
    code: "L1",
    name: "Approver (junior)",
    productCode: "PL",
    rank: 1,
    maxAmount: "100000.00",
    grades: ["A", "B"],
    exceptions: [],
    approvers: [{ fullName: "Ben Castro" }],
  },
  {
    code: "L3",
    name: "Head of credit",
    productCode: "PL",
    rank: 3,
    maxAmount: "3000000.00",
    grades: ["A", "C", "D"],
    exceptions: ["OVERRIDE", "POLICY_EXCEPTION", "RELATED_PARTY"],
    approvers: [],
  },
];

describe("the approval matrix screen (AM-1, PRD WF-004)", () => {
  it("shows each level: who holds it, product, limit, grades and the exceptions it may approve", () => {
    render(<ApprovalMatrixTable levels={LEVELS} />);
    const rows = screen.getAllByRole("row").slice(1);
    expect(rows[0]).toHaveTextContent("L1");
    expect(rows[0]).toHaveTextContent("Ben Castro");
    expect(rows[0]).toHaveTextContent("Personal loan");
    expect(rows[0]).toHaveTextContent("₱100,000.00");
    expect(rows[0]).toHaveTextContent("A–B");
    expect(
      within(rows[0] as HTMLElement)
        .getAllByRole("cell")
        .at(-1),
    ).toHaveTextContent("None");
    expect(rows[1]).toHaveTextContent("Nobody holds this level");
    expect(rows[1]).toHaveTextContent("₱3,000,000.00");
    // Grades that skip one are listed, not shown as a range.
    expect(rows[1]).toHaveTextContent("A, C, D");
    expect(rows[1]).toHaveTextContent(
      "Override of the automated decision · Policy exception · Related-party loan",
    );
  });

  it("is in the sidebar for approvers, administrators and compliance only", () => {
    const has = (role: Parameters<typeof navFor>[0]) =>
      navFor(role).some((g) => g.items.some((i) => i.href === "/approval-matrix"));
    expect(["APPROVER", "ADMIN", "COMPLIANCE"].every((r) => has(r as never))).toBe(true);
    expect(["LOAN_OFFICER", "LOAN_OPERATIONS"].some((r) => has(r as never))).toBe(false);
  });
});

const awaiting = (route: CaseDetail["approvalRoute"]) =>
  ({
    id: "case-1",
    status: "APPROVAL",
    escalated: true,
    applicant: { fullName: "Joel Reyes" },
    documents: [],
    allowedActions: [],
    approvalRoute: route,
  }) as unknown as CaseDetail;

const panel = (c: CaseDetail) =>
  render(
    <ToastProvider>
      <ShellRefresh.Provider value={vi.fn()}>
        <ActionsPanel detail={c} onChanged={vi.fn()} onShowDecision={vi.fn()} />
      </ShellRefresh.Provider>
    </ToastProvider>,
  );

describe("gradeRange", () => {
  it("shows a run of grades as a range and anything else as a list", () => {
    expect(gradeRange(["A", "B", "C"])).toBe("A–C");
    expect(gradeRange(["C", "A", "B"])).toBe("A–C");
    expect(gradeRange(["A", "C"])).toBe("A, C");
    expect(gradeRange(["D"])).toBe("D");
    expect(gradeRange([])).toBe("None");
  });
});

describe("the case says which level may approve it (AM-1)", () => {
  it("names the level and why", () => {
    panel(
      awaiting({ exceptions: ["POLICY_EXCEPTION"], level: { code: "L3", name: "Head of credit" } }),
    );
    expect(
      screen.getByText(/Approval matrix: L3 · Head of credit or above \(policy exception\)\./),
    ).toBeInTheDocument();
  });

  it("says when no level covers it", () => {
    panel(awaiting({ exceptions: [], level: null }));
    expect(
      screen.getByText(
        /Approval matrix: no level covers it; it can only be declined or returned\./,
      ),
    ).toBeInTheDocument();
  });

  it("Approve stays clickable only when it would escalate to a level that covers the case", () => {
    const blocked = {
      action: "APPROVE" as const,
      enabled: false as const,
      blockedBy: "AUTHORITY_LIMIT_EXCEEDED" as const,
      detail:
        "grade E is outside the grades you may approve (A, B, C, D). No level of the approval matrix covers it: decline it or return it.",
    };
    const { unmount } = panel({
      ...awaiting({ exceptions: [], level: null }),
      allowedActions: [
        blocked,
        { action: "DECLINE", enabled: true },
        { action: "RETURN", enabled: true },
      ],
    } as CaseDetail);
    expect(screen.getByRole("button", { name: "Approve" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Decline" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Return to loan officer" })).toBeEnabled();
    unmount();
    panel({
      ...awaiting({ exceptions: [], level: { code: "L2", name: "Approver" } }),
      allowedActions: [{ ...blocked, escalates: true }],
    } as CaseDetail);
    expect(screen.getByRole("button", { name: "Approve" })).toBeEnabled();
  });
});
