import { CaseStatus, Money, ProblemCode, Role } from "@loan/core";
import {
  bookingChecklist,
  type ChecklistCase,
  type ChecklistDecision,
  checklistRefusal,
} from "../../src/cases/booking-checklist";
import { allowedActions } from "../../src/cases/case-access";
import type { LoanCaseEntity } from "../../src/cases/entities/loan-case.entity";

const NOW = new Date("2026-11-28T04:00:00.000Z");

const signedCase = (patch: Partial<ChecklistCase> = {}): ChecklistCase => ({
  status: CaseStatus.Booking,
  approvedAmount: Money.of("150000.00"),
  approvedTenorMonths: 24,
  approvedMonthlyRate: "0.0120",
  approvedBy: null,
  signatureEnvelopeId: "ENV-SIM-0001",
  applicant: { depositAccount: "WB-SAV-0021-4410" },
  ...patch,
});

const screened = (
  createdAt = new Date("2026-11-20T04:00:00.000Z"),
  screening: ChecklistDecision["inputs"]["screening"] = {
    status: "OK",
    kycVerified: true,
    sanctionsMatch: false,
  },
): ChecklistDecision => ({ inputs: { screening }, createdAt });

const failing = (items: ReturnType<typeof bookingChecklist>) =>
  (items ?? []).filter((i) => !i.passed).map((i) => i.check);

describe("the pre-booking checklist (BK-1, PRD BKG-001)", () => {
  it("passes all four items for an approved, signed, screened case with its own account", () => {
    const items = bookingChecklist(signedCase(), screened(), NOW);
    expect(items?.map((i) => [i.check, i.passed])).toEqual([
      ["APPROVALS_COMPLETE", true],
      ["DOCUMENTS_SIGNED", true],
      ["KYC_VALID", true],
      ["DISBURSEMENT_ACCOUNT_VERIFIED", true],
    ]);
    expect(items?.[0]?.detail).toBe("₱150000.00 over 24 months, approved automatically");
    expect(items?.[2]?.detail).toBe(
      "Identity verified and sanctions clear on 2026-11-20 (valid until 2027-11-20)",
    );
    expect(checklistRefusal(items)).toBeNull();
  });

  it.each([
    CaseStatus.Draft,
    CaseStatus.Review,
    CaseStatus.Approval,
    CaseStatus.Offer,
    CaseStatus.Disbursed,
    CaseStatus.Withdrawn,
  ])("is not shown in %s", (status) => {
    expect(bookingChecklist(signedCase({ status }), screened(), NOW)).toBeNull();
  });

  it.each([CaseStatus.PendingChecker, CaseStatus.BookingFailed])(
    "is still shown in %s (what the checker sees)",
    (status) => {
      expect(bookingChecklist(signedCase({ status }), screened(), NOW)).toHaveLength(4);
    },
  );

  it.each<[string, ChecklistCase, ChecklistDecision | null, string]>([
    ["no approved terms", signedCase({ approvedAmount: null }), screened(), "APPROVALS_COMPLETE"],
    ["no signature", signedCase({ signatureEnvelopeId: null }), screened(), "DOCUMENTS_SIGNED"],
    ["no decision record", signedCase(), null, "KYC_VALID"],
    [
      "screening unavailable",
      signedCase(),
      screened(undefined, { status: "UNAVAILABLE", reason: "outage" }),
      "KYC_VALID",
    ],
    [
      "identity not verified",
      signedCase(),
      screened(undefined, { status: "OK", kycVerified: false, sanctionsMatch: false }),
      "KYC_VALID",
    ],
    [
      "a sanctions match",
      signedCase(),
      screened(undefined, { status: "OK", kycVerified: true, sanctionsMatch: true }),
      "KYC_VALID",
    ],
    [
      "screening exactly 12 months old",
      signedCase(),
      screened(new Date("2025-11-28T04:00:00.000Z")),
      "KYC_VALID",
    ],
    [
      "no deposit account",
      signedCase({ applicant: { depositAccount: "" } }),
      screened(),
      "DISBURSEMENT_ACCOUNT_VERIFIED",
    ],
    [
      "an account that is not a WhiteBank deposit account",
      signedCase({ applicant: { depositAccount: "BPI-1234567890" } }),
      screened(),
      "DISBURSEMENT_ACCOUNT_VERIFIED",
    ],
  ])("fails with %s", (_label, c, decision, check) => {
    const items = bookingChecklist(c, decision, NOW);
    expect(failing(items)).toEqual([check]);
    expect(checklistRefusal(items)).toMatch(/^Pre-booking checklist: .+ — .+\. The booking cannot/);
  });

  it("accepts screening a moment younger than 12 months", () => {
    const items = bookingChecklist(signedCase(), screened(new Date("2025-11-28T04:00:01Z")), NOW);
    expect(failing(items)).toEqual([]);
  });

  it("names the first failing item in the refusal", () => {
    const items = bookingChecklist(
      signedCase({ signatureEnvelopeId: null, applicant: { depositAccount: "" } }),
      screened(),
      NOW,
    );
    expect(checklistRefusal(items)).toBe(
      "Pre-booking checklist: Documents signed — The borrower's signature is outstanding. The booking cannot go ahead until every item passes.",
    );
  });
});

describe("SUBMIT_BOOKING mirrors the checklist (one gate)", () => {
  const ops = { id: "STF-MARCO", role: Role.LoanOperations, fullName: "Marco Bautista" };
  const c = { ...signedCase(), id: "case-1", decisionId: "d-1" } as unknown as LoanCaseEntity;

  it("is enabled when the checklist passes", () => {
    expect(allowedActions(ops, c, null, null, false, true, null)).toContainEqual({
      action: "SUBMIT_BOOKING",
      enabled: true,
    });
  });

  it("is disabled with the API's refusal when an item fails", () => {
    const refusal = "Pre-booking checklist: KYC valid — Identity was not verified. …";
    expect(allowedActions(ops, c, null, null, false, true, refusal)).toContainEqual({
      action: "SUBMIT_BOOKING",
      enabled: false,
      blockedBy: ProblemCode.BookingChecklistIncomplete,
      detail: refusal,
    });
  });
});

describe("the checker's APPROVE_BOOKING and RETRY_BOOKING mirror it too", () => {
  const checker = { id: "STF-LITO", role: Role.LoanOperationsSupervisor, fullName: "Lito Garcia" };
  const refusal = "Pre-booking checklist: KYC valid — Identity was not verified. …";
  const booking = { makerId: "STF-MARCO" } as never;

  it.each([
    [CaseStatus.PendingChecker, "APPROVE_BOOKING"],
    [CaseStatus.BookingFailed, "RETRY_BOOKING"],
  ] as const)("in %s, %s is disabled with the refusal", (status, action) => {
    const c = { ...signedCase({ status }), id: "c", decisionId: "d" } as unknown as LoanCaseEntity;
    expect(allowedActions(checker, c, null, booking, false, true, refusal)).toContainEqual({
      action,
      enabled: false,
      blockedBy: ProblemCode.BookingChecklistIncomplete,
      detail: refusal,
    });
    expect(allowedActions(checker, c, null, booking, false, true, null)).toContainEqual({
      action,
      enabled: true,
    });
  });

  it("maker-checker is named first when both refuse", () => {
    const c = {
      ...signedCase({ status: CaseStatus.PendingChecker }),
      id: "c",
      decisionId: "d",
    } as unknown as LoanCaseEntity;
    const own = { makerId: "STF-LITO" } as never;
    expect(allowedActions(checker, c, null, own, false, true, refusal)).toContainEqual(
      expect.objectContaining({ action: "APPROVE_BOOKING", blockedBy: ProblemCode.MakerChecker }),
    );
  });
});
