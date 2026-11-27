import { CaseStatus, DocumentStatus, ProblemCode, Role } from "@loan/core";
import { allowedActions } from "../../src/cases/case-access";
import {
  type ChecklistDocument,
  documentActions,
  requestableTypes,
  requestRefusal,
  unreviewedRefusal,
} from "../../src/cases/documents";
import type { LoanCaseEntity } from "../../src/cases/entities/loan-case.entity";

const doc = (documentType: ChecklistDocument["documentType"], status: DocumentStatus) => ({
  documentType,
  status,
});

describe("the document checklist rules (DC-1..DC-3, PRD WF-007, DOC-003)", () => {
  it("everything can be requested at first; a verified document never again; a rejected one again", () => {
    expect(requestableTypes([])).toEqual([
      "BANK_STATEMENTS_3M",
      "CERTIFICATE_OF_EMPLOYMENT",
      "INCOME_TAX_RETURN",
    ]);
    expect(
      requestableTypes([
        doc("BANK_STATEMENTS_3M", DocumentStatus.Verified),
        doc("CERTIFICATE_OF_EMPLOYMENT", DocumentStatus.Rejected),
      ]),
    ).toEqual(["CERTIFICATE_OF_EMPLOYMENT", "INCOME_TAX_RETURN"]);
  });

  it("a received document blocks recommending and a new request, naming it", () => {
    const docs = [
      doc("BANK_STATEMENTS_3M", DocumentStatus.Received),
      doc("INCOME_TAX_RETURN", DocumentStatus.Verified),
    ];
    const reason = "Verify or reject the received document first: Bank statements, last 3 months.";
    expect(unreviewedRefusal(docs)).toBe(reason);
    expect(requestRefusal(docs)).toBe(reason);
    expect(unreviewedRefusal([doc("BANK_STATEMENTS_3M", DocumentStatus.Rejected)])).toBeNull();
  });

  it("nothing left to request once every type is verified", () => {
    const all = [
      doc("BANK_STATEMENTS_3M", DocumentStatus.Verified),
      doc("CERTIFICATE_OF_EMPLOYMENT", DocumentStatus.Verified),
      doc("INCOME_TAX_RETURN", DocumentStatus.Verified),
    ];
    expect(requestRefusal(all)).toBe(
      "Every document that can be requested has already been verified.",
    );
  });

  it.each([
    [DocumentStatus.Requested, CaseStatus.InfoRequested, ["SIMULATE_UPLOAD"]],
    [DocumentStatus.Requested, CaseStatus.Withdrawn, []],
    [DocumentStatus.Received, CaseStatus.InfoRequested, ["VERIFY", "REJECT"]],
    [DocumentStatus.Received, CaseStatus.Review, ["VERIFY", "REJECT"]],
    [DocumentStatus.Received, CaseStatus.Approval, []],
    [DocumentStatus.Verified, CaseStatus.Review, []],
    [DocumentStatus.Rejected, CaseStatus.Review, []],
  ])("a %s document in %s offers %j to the loan officer", (status, caseStatus, actions) => {
    expect(
      documentActions(Role.LoanOfficer, caseStatus, doc("BANK_STATEMENTS_3M", status)),
    ).toEqual(actions);
  });

  it.each([Role.Approver, Role.Compliance, Role.LoanOperations, Role.Admin])(
    "%s is offered nothing on a document",
    (role) => {
      expect(
        documentActions(
          role,
          CaseStatus.InfoRequested,
          doc("BANK_STATEMENTS_3M", DocumentStatus.Requested),
        ),
      ).toEqual([]);
    },
  );
});

describe("REQUEST_INFO and RECOMMEND mirror the checklist (one gate)", () => {
  const officer = { id: "STF-PAOLO", role: Role.LoanOfficer, fullName: "Paolo Tan" };
  const inReview = { status: CaseStatus.Review, decisionId: "d" } as unknown as LoanCaseEntity;

  it("both are offered in review when nothing waits", () => {
    const actions = allowedActions(officer, inReview, null, null, false, true, null);
    expect(actions).toContainEqual({ action: "REQUEST_INFO", enabled: true });
    expect(actions).toContainEqual({ action: "RECOMMEND", enabled: true });
  });

  it("both are disabled with the API's refusal while a document waits for review", () => {
    const reason = "Verify or reject the received document first: Certificate of employment.";
    const actions = allowedActions(officer, inReview, null, null, false, true, null, null, {
      request: reason,
      recommend: reason,
    });
    for (const action of ["REQUEST_INFO", "RECOMMEND"] as const) {
      expect(actions).toContainEqual({
        action,
        enabled: false,
        blockedBy: ProblemCode.InvalidTransition,
        detail: reason,
      });
    }
  });

  it("a case waiting for the borrower offers only withdrawing and the record", () => {
    const waiting = {
      status: CaseStatus.InfoRequested,
      decisionId: "d",
    } as unknown as LoanCaseEntity;
    expect(allowedActions(officer, waiting, null, null).map((a) => a.action)).toEqual([
      "WITHDRAW",
      "REPRODUCE_DECISION",
    ]);
  });
});
