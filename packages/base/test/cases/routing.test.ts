import { CaseStatus, Priority, Role } from "@loan/core";
import { allowedActions } from "../../src/cases/case-access";
import type { LoanCaseEntity } from "../../src/cases/entities/loan-case.entity";
import { canPick, queueOrder, withOfficers } from "../../src/cases/routing";

describe("queue routing rules (QR-1, PRD WF-002)", () => {
  it.each([
    [CaseStatus.Review, null, true],
    [CaseStatus.InfoRequested, null, true],
    [CaseStatus.Review, "STF-JOY", false],
    [CaseStatus.Draft, null, false],
    [CaseStatus.Approval, null, false],
  ] as const)("a case in %s owned by %s can be picked: %s", (status, ownerId, expected) => {
    expect(canPick({ status, ownerId })).toBe(expected);
  });

  it("only draft, review and information requested are with the loan officers", () => {
    expect(Object.values(CaseStatus).filter(withOfficers)).toEqual([
      CaseStatus.Draft,
      CaseStatus.Review,
      CaseStatus.InfoRequested,
    ]);
  });

  it("orders high priority first, then the longest waiting", () => {
    const at = (iso: string, priority: Priority) => ({
      id: iso,
      priority,
      updatedAt: new Date(iso),
    });
    const cases = [
      at("2026-11-27T00:00:00Z", Priority.Normal),
      at("2026-11-28T00:00:00Z", Priority.High),
      at("2026-11-20T00:00:00Z", Priority.Normal),
      at("2026-11-25T00:00:00Z", Priority.High),
    ];
    expect([...cases].sort(queueOrder).map((c) => c.id)).toEqual([
      "2026-11-25T00:00:00Z",
      "2026-11-28T00:00:00Z",
      "2026-11-20T00:00:00Z",
      "2026-11-27T00:00:00Z",
    ]);
  });
});

describe("routing actions mirror the rules", () => {
  const officer = { id: "STF-PAOLO", role: Role.LoanOfficer, fullName: "Paolo Tan" };
  const kase = (status: CaseStatus, ownerId: string | null) =>
    ({ status, ownerId, decisionId: "d" }) as unknown as LoanCaseEntity;

  it("an unassigned referral offers Pick, Reassign and Change priority", () => {
    const actions = allowedActions(officer, kase(CaseStatus.Review, null), null, null).map(
      (a) => a.action,
    );
    expect(actions).toEqual(expect.arrayContaining(["PICK", "REASSIGN", "SET_PRIORITY"]));
  });

  it("an owned referral is not offered for picking", () => {
    const actions = allowedActions(officer, kase(CaseStatus.Review, "STF-JOY"), null, null).map(
      (a) => a.action,
    );
    expect(actions).not.toContain("PICK");
    expect(actions).toContain("REASSIGN");
  });

  it("a case with the approvers offers no routing, and other roles never see it", () => {
    expect(
      allowedActions(officer, kase(CaseStatus.Approval, "STF-PAOLO"), null, null).map(
        (a) => a.action,
      ),
    ).not.toEqual(expect.arrayContaining(["REASSIGN"]));
    const approver = { id: "STF-RINA", role: Role.Approver, fullName: "Rina Aquino" };
    expect(
      allowedActions(approver, kase(CaseStatus.Review, null), null, null).map((a) => a.action),
    ).not.toContain("PICK");
  });
});
