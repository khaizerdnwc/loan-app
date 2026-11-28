import { CaseStatus, Role } from "@loan/core";
import {
  BORROWER_TEMPLATES,
  type CaseEventFacts,
  planFor,
} from "../../src/notifications/notification-rules";

const event = (over: Partial<CaseEventFacts>): CaseEventFacts => ({
  action: "NOTE_ADDED",
  actorId: "STF-PAOLO",
  toStatus: null,
  details: {},
  reference: "WB-2026-000123",
  ownerId: null,
  ...over,
});

describe("who hears about a case event (PRD NTF-001, NTF-002)", () => {
  it("NTF-2 a reassignment alerts the new owner by name; a pick (one's own) alerts nobody", () => {
    expect(
      planFor(event({ action: "CASE_REASSIGNED", details: { toOwnerId: "STF-JOY" } })).alerts,
    ).toEqual([
      {
        role: Role.LoanOfficer,
        staffId: "STF-JOY",
        kind: "ASSIGNED",
        title: "WB-2026-000123 was reassigned to you",
      },
    ]);
    expect(
      planFor(event({ action: "CASE_PICKED", details: { ownerId: "STF-PAOLO" } })).alerts,
    ).toEqual([]);
  });

  it("NTF-2 work waiting for a role alerts the role: approval, escalation, signature, booking check, failure", () => {
    const kinds = (action: string, toStatus: CaseStatus | null = null) =>
      planFor(event({ action, toStatus })).alerts.map((a) => [a.role, a.staffId, a.kind]);
    expect(kinds("RECOMMENDED")).toEqual([[Role.Approver, null, "APPROVAL_WAITING"]]);
    expect(kinds("RECOMMENDED_WITH_OVERRIDE")).toEqual([[Role.Approver, null, "APPROVAL_WAITING"]]);
    expect(kinds("ESCALATED")).toEqual([[Role.Approver, null, "ESCALATED"]]);
    expect(kinds("APPROVED")).toEqual([[Role.LoanOperations, null, "OFFER_TO_SIGN"]]);
    expect(kinds("DECISION_MADE", CaseStatus.Offer)).toEqual([
      [Role.LoanOperations, null, "OFFER_TO_SIGN"],
    ]);
    expect(kinds("BOOKING_SUBMITTED")).toEqual([
      [Role.LoanOperationsSupervisor, null, "BOOKING_TO_CHECK"],
    ]);
    expect(kinds("BOOKING_FAILED")).toEqual([
      [Role.LoanOperationsSupervisor, null, "BOOKING_FAILED"],
    ]);
    expect(kinds("NOTE_ADDED")).toEqual([]);
  });

  it("NTF-2 a return goes to the owning officer, never to the person who returned it", () => {
    expect(
      planFor(event({ action: "RETURNED", actorId: "STF-RINA", ownerId: "STF-PAOLO" })).alerts,
    ).toEqual([
      expect.objectContaining({ staffId: "STF-PAOLO", kind: "RETURNED", role: Role.LoanOfficer }),
    ]);
    expect(planFor(event({ action: "RETURNED", actorId: "STF-RINA" })).alerts).toEqual([
      expect.objectContaining({ staffId: null, kind: "RETURNED", role: Role.LoanOfficer }),
    ]);
    expect(
      planFor(event({ action: "RETURNED", actorId: "STF-PAOLO", ownerId: "STF-PAOLO" })).alerts,
    ).toEqual([]);
  });

  it("NTF-1 the borrower hears about the outcome, documents asked for, and the money released", () => {
    const told = (action: string, toStatus: CaseStatus | null = null) =>
      planFor(event({ action, toStatus })).messages;
    expect(told("DECISION_MADE", CaseStatus.Offer)).toEqual([
      { template: "OFFER_READY", channels: ["EMAIL", "SMS"] },
    ]);
    expect(told("DECISION_MADE", CaseStatus.Review)).toEqual([
      { template: "UNDER_REVIEW", channels: ["EMAIL"] },
    ]);
    expect(told("REDECIDED", CaseStatus.Declined)).toEqual([
      { template: "DECLINED", channels: ["EMAIL"] },
    ]);
    expect(told("DECLINED")).toEqual([{ template: "DECLINED", channels: ["EMAIL"] }]);
    expect(told("INFO_REQUESTED")).toEqual([
      { template: "DOCUMENTS_REQUESTED", channels: ["EMAIL", "SMS"] },
    ]);
    expect(told("BOOKING_APPROVED")).toEqual([
      { template: "DISBURSED", channels: ["EMAIL", "SMS"] },
    ]);
    expect(told("WITHDRAWN")).toEqual([{ template: "WITHDRAWN", channels: ["EMAIL"] }]);
    // Internal steps tell the borrower nothing.
    expect(told("RECOMMENDED")).toEqual([]);
    expect(told("BOOKING_SUBMITTED")).toEqual([]);
  });

  it("NTF-1 nothing about an AML review reaches the borrower (no tipping-off); Compliance is alerted", () => {
    const plan = planFor(event({ action: "AML_ESCALATION_OPENED", actorId: "SYSTEM" }));
    expect(plan.messages).toEqual([]);
    expect(plan.alerts).toEqual([expect.objectContaining({ role: Role.Compliance })]);
  });

  it("NTF-1 the borrower wording names the case reference only: no score, reason code, list or internal step", () => {
    for (const { subject, body } of Object.values(BORROWER_TEMPLATES)) {
      const words = `${subject} ${body}`;
      expect(words).not.toMatch(/score|reason code|watchlist|AML|sanction|fraud|bureau|override/i);
      expect(body).toContain("{ref}");
    }
  });
});
