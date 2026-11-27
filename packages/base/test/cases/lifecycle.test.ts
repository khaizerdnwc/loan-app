import { CaseStatus, CLOSED_CASE_STATUSES } from "@loan/core";
import {
  assertTransition,
  type CaseEvent,
  canHappen,
  InvalidTransitionError,
  moveTo,
  startDraft,
} from "../../src/cases/lifecycle";

const EVENTS: CaseEvent[] = [
  "SUBMIT",
  "REDECIDE",
  "REQUEST_INFO",
  "INFO_RECEIVED",
  "RECOMMEND",
  "APPROVE",
  "DECLINE",
  "RETURN",
  "SIGN",
  "SUBMIT_BOOKING",
  "BOOKING_SUCCEEDED",
  "BOOKING_FAILED",
  "WITHDRAW",
  "EXPIRE",
];

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
    ["REDECIDE", CaseStatus.Review, CaseStatus.Offer],
    ["REDECIDE", CaseStatus.Review, CaseStatus.Review],
    ["REDECIDE", CaseStatus.Review, CaseStatus.Declined],
    ["REQUEST_INFO", CaseStatus.Review, CaseStatus.InfoRequested],
    ["INFO_RECEIVED", CaseStatus.InfoRequested, CaseStatus.Review],
    ["WITHDRAW", CaseStatus.InfoRequested, CaseStatus.Withdrawn],
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
    ["WITHDRAW", CaseStatus.Draft, CaseStatus.Withdrawn],
    ["WITHDRAW", CaseStatus.Review, CaseStatus.Withdrawn],
    ["WITHDRAW", CaseStatus.Approval, CaseStatus.Withdrawn],
    ["WITHDRAW", CaseStatus.Offer, CaseStatus.Withdrawn],
    ["EXPIRE", CaseStatus.Draft, CaseStatus.Expired],
    ["EXPIRE", CaseStatus.Offer, CaseStatus.Expired],
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

  it.each(Object.values(CaseStatus).filter((s) => s !== CaseStatus.Review))(
    "REDECIDE is refused from %s",
    (from) => {
      expect(canHappen("REDECIDE", from)).toBe(false);
    },
  );

  it("REDECIDE cannot take a case to approval", () => {
    expect(() => assertTransition("REDECIDE", CaseStatus.Review, CaseStatus.Approval)).toThrow(
      InvalidTransitionError,
    );
  });

  const WITHDRAWABLE: CaseStatus[] = [
    CaseStatus.Draft,
    CaseStatus.Review,
    CaseStatus.InfoRequested,
    CaseStatus.Approval,
    CaseStatus.Offer,
  ];
  it.each(Object.values(CaseStatus).filter((s) => !WITHDRAWABLE.includes(s)))(
    "WITHDRAW is refused from %s",
    (from) => {
      expect(canHappen("WITHDRAW", from)).toBe(false);
      const c = { status: from as CaseStatus };
      expect(() => moveTo(c, "WITHDRAW", CaseStatus.Withdrawn)).toThrow(InvalidTransitionError);
      expect(c.status).toBe(from);
    },
  );

  it.each(Object.values(CaseStatus).filter((s) => s !== CaseStatus.Review))(
    "REQUEST_INFO is refused from %s (only a referred case in review asks for information)",
    (from) => {
      expect(canHappen("REQUEST_INFO", from)).toBe(false);
    },
  );

  it.each(Object.values(CaseStatus).filter((s) => s !== CaseStatus.InfoRequested))(
    "INFO_RECEIVED is refused from %s",
    (from) => {
      expect(canHappen("INFO_RECEIVED", from)).toBe(false);
    },
  );

  it("a case waiting for information can only go back to review or be withdrawn", () => {
    expect(EVENTS.filter((e) => canHappen(e, CaseStatus.InfoRequested))).toEqual([
      "INFO_RECEIVED",
      "WITHDRAW",
    ]);
    expect(() =>
      assertTransition("INFO_RECEIVED", CaseStatus.InfoRequested, CaseStatus.Approval),
    ).toThrow(InvalidTransitionError);
  });

  const EXPIRABLE: CaseStatus[] = [CaseStatus.Draft, CaseStatus.Offer];
  it.each(Object.values(CaseStatus).filter((s) => !EXPIRABLE.includes(s)))(
    "EXPIRE is refused from %s",
    (from) => {
      expect(canHappen("EXPIRE", from)).toBe(false);
      const c = { status: from as CaseStatus };
      expect(() => moveTo(c, "EXPIRE", CaseStatus.Expired)).toThrow(InvalidTransitionError);
      expect(c.status).toBe(from);
    },
  );

  it("WITHDRAW and EXPIRE lead only to their own closed status", () => {
    expect(() => assertTransition("WITHDRAW", CaseStatus.Offer, CaseStatus.Expired)).toThrow(
      InvalidTransitionError,
    );
    expect(() => assertTransition("EXPIRE", CaseStatus.Draft, CaseStatus.Withdrawn)).toThrow(
      InvalidTransitionError,
    );
  });

  it.each(CLOSED_CASE_STATUSES)("no event leaves the closed status %s", (closed) => {
    for (const event of EVENTS) expect(canHappen(event, closed)).toBe(false);
  });

  it("a disbursed case cannot be booked again", () => {
    expect(canHappen("BOOKING_SUCCEEDED", CaseStatus.Disbursed)).toBe(false);
    expect(canHappen("BOOKING_FAILED", CaseStatus.Disbursed)).toBe(false);
  });
});
