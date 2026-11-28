import { Money } from "@loan/core";
import type { ApprovalLevelEntity } from "../../src/auth/approval-level.entity";
import {
  authorityProblem,
  caseExceptions,
  coveringLevel,
  escalates,
  levelProblems,
  type MatrixCase,
} from "../../src/cases/approval-matrix";

const level = (patch: Partial<ApprovalLevelEntity>): ApprovalLevelEntity =>
  ({
    code: "L2",
    name: "Approver",
    productCode: "PL",
    rank: 2,
    maxAmount: Money.of("1000000.00"),
    grades: ["A", "B", "C"],
    exceptions: ["OVERRIDE"],
    ...patch,
  }) as ApprovalLevelEntity;

const MATRIX = [
  level({
    code: "L1",
    name: "Approver (junior)",
    rank: 1,
    maxAmount: Money.of("100000.00"),
    grades: ["A", "B"],
    exceptions: [],
  }),
  level({}),
  level({
    code: "L3",
    name: "Head of credit",
    rank: 3,
    maxAmount: Money.of("3000000.00"),
    grades: ["A", "B", "C", "D"],
    exceptions: ["OVERRIDE", "POLICY_EXCEPTION", "RELATED_PARTY"],
  }),
];

const kase = (patch: Partial<MatrixCase> = {}): MatrixCase => ({
  productCode: "PL",
  requestedAmount: Money.of("200000.00"),
  recommendedAmount: null,
  grade: "C",
  isOverride: false,
  overrideReason: null,
  ...patch,
});

describe("the approval matrix rule (AM-1, PRD WF-004)", () => {
  it("names the exceptions a case carries: override, policy exception (OV05), related party", () => {
    expect(caseExceptions(kase(), null)).toEqual([]);
    expect(
      caseExceptions(kase({ isOverride: true, overrideReason: "OV05" }), {
        inputs: { applicant: { relatedParty: true } },
      }),
    ).toEqual(["OVERRIDE", "POLICY_EXCEPTION", "RELATED_PARTY"]);
    expect(caseExceptions(kase({ isOverride: true, overrideReason: "OV04" }), null)).toEqual([
      "OVERRIDE",
    ]);
    // A related party flagged on the applicant record after the decision still counts.
    expect(caseExceptions(kase({ applicant: { relatedParty: true } }), null)).toEqual([
      "RELATED_PARTY",
    ]);
    expect(
      caseExceptions(kase({ applicant: { relatedParty: false } }), {
        inputs: { applicant: { relatedParty: true } },
      }),
    ).toEqual(["RELATED_PARTY"]);
  });

  it("judges the amount to approve: the recommendation's, else the request's", () => {
    const l1 = MATRIX[0] as ApprovalLevelEntity;
    expect(
      levelProblems(l1, kase({ grade: "A", recommendedAmount: Money.of("90000.00") }), []),
    ).toEqual([]);
    expect(levelProblems(l1, kase({ grade: "A" }), [])).toEqual([
      "₱200000.00 is above your approval limit of ₱100000.00",
    ]);
  });

  it("checks product, grade and every undelegated exception", () => {
    const l2 = MATRIX[1] as ApprovalLevelEntity;
    expect(
      levelProblems(l2, kase({ productCode: "HL", grade: "D" }), ["OVERRIDE", "RELATED_PARTY"]),
    ).toEqual([
      "your level (L2) does not cover the HL product",
      "grade D is outside the grades you may approve (A, B, C)",
      "a related-party loan is not delegated to L2",
    ]);
  });

  it("a level whose limit is missing has no authority, never an unlimited one", () => {
    const broken = level({ maxAmount: null as unknown as Money });
    expect(levelProblems(broken, kase({ requestedAmount: Money.of("20000.00") }), [])).toEqual([
      "₱20000.00 is above your approval limit of ₱0.00",
    ]);
  });

  it("a refused approval escalates only from a held level to a level that covers the case", () => {
    const l1 = { approvalLevel: MATRIX[0] as ApprovalLevelEntity };
    expect(escalates(l1, kase(), ["OVERRIDE"], MATRIX)).toBe(true);
    expect(escalates(l1, kase({ grade: "E" }), [], MATRIX)).toBe(false);
    expect(escalates({ approvalLevel: null }, kase(), [], MATRIX)).toBe(false);
    expect(escalates(null, kase(), [], MATRIX)).toBe(false);
  });

  it("routes to the lowest level that covers the case, or says no level does", () => {
    expect(
      coveringLevel(MATRIX, kase({ grade: "A", requestedAmount: Money.of("50000.00") }), [])?.code,
    ).toBe("L1");
    expect(coveringLevel(MATRIX, kase(), ["OVERRIDE"])?.code).toBe("L2");
    expect(coveringLevel(MATRIX, kase(), ["POLICY_EXCEPTION"])?.code).toBe("L3");
    expect(coveringLevel(MATRIX, kase({ grade: "E" }), [])).toBeNull();
    expect(
      authorityProblem(
        { approvalLevel: MATRIX[1] as ApprovalLevelEntity },
        kase({ grade: "E" }),
        [],
        MATRIX,
      ),
    ).toBe(
      "grade E is outside the grades you may approve (A, B, C). No level of the approval matrix covers it: decline it or return it (a credit committee is not part of this release).",
    );
  });

  it("an approver within their level is not refused; one with no level always is", () => {
    expect(
      authorityProblem(
        { approvalLevel: MATRIX[1] as ApprovalLevelEntity },
        kase(),
        ["OVERRIDE"],
        MATRIX,
      ),
    ).toBeNull();
    expect(authorityProblem({ approvalLevel: null }, kase(), [], MATRIX)).toBe(
      "You hold no level in the approval matrix, so you cannot approve.",
    );
  });
});
