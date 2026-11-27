import { CaseStatus } from "@loan/core";
import {
  assertTransition,
  canHappen,
  InvalidTransitionError,
  moveTo,
  startDraft,
} from "../../src/cases/lifecycle";

describe("the case transition table", () => {
  it("a new case starts as a draft", () => {
    const c = { status: CaseStatus.Offer as CaseStatus };
    startDraft(c);
    expect(c.status).toBe(CaseStatus.Draft);
  });

  it.each([
    ["SUBMIT", CaseStatus.Draft, CaseStatus.Offer],
    ["SUBMIT", CaseStatus.Draft, CaseStatus.Review],
    ["SUBMIT", CaseStatus.Draft, CaseStatus.Declined],
    ["RECOMMEND", CaseStatus.Review, CaseStatus.Approval],
    ["APPROVE", CaseStatus.Approval, CaseStatus.Offer],
    ["DECLINE", CaseStatus.Approval, CaseStatus.Declined],
    ["RETURN", CaseStatus.Approval, CaseStatus.Review],
    ["SIGN", CaseStatus.Offer, CaseStatus.Booking],
    ["SUBMIT_BOOKING", CaseStatus.Booking, CaseStatus.PendingChecker],
    ["BOOKING_SUCCEEDED", CaseStatus.PendingChecker, CaseStatus.Disbursed],
    ["BOOKING_SUCCEEDED", CaseStatus.BookingFailed, CaseStatus.Disbursed],
    ["BOOKING_FAILED", CaseStatus.PendingChecker, CaseStatus.BookingFailed],
    ["BOOKING_FAILED", CaseStatus.BookingFailed, CaseStatus.BookingFailed],
  ] as const)("%s moves a case from %s to %s", (event, from, to) => {
    const c = { status: from as CaseStatus };
    moveTo(c, event, to);
    expect(c.status).toBe(to);
  });

  it("refuses an event from a status the table does not start it from, and leaves the status", () => {
    const c = { status: CaseStatus.Review as CaseStatus };
    expect(() => moveTo(c, "APPROVE", CaseStatus.Offer)).toThrow(InvalidTransitionError);
    expect(c.status).toBe(CaseStatus.Review);
    expect(canHappen("APPROVE", CaseStatus.Review)).toBe(false);
  });

  it("refuses a target the edge does not draw, even from the right status", () => {
    const c = { status: CaseStatus.Approval as CaseStatus };
    expect(() => moveTo(c, "APPROVE", CaseStatus.Disbursed)).toThrow(/from APPROVAL to DISBURSED/);
    expect(c.status).toBe(CaseStatus.Approval);
    expect(() => assertTransition("SUBMIT", CaseStatus.Draft, CaseStatus.Booking)).toThrow(
      InvalidTransitionError,
    );
  });

  it("a disbursed case cannot be booked again", () => {
    expect(canHappen("BOOKING_SUCCEEDED", CaseStatus.Disbursed)).toBe(false);
    expect(canHappen("BOOKING_FAILED", CaseStatus.Disbursed)).toBe(false);
  });
});
