/**
 * The business calendar (PRD PLT-005): the non-working days the Philippine business clock
 * skips, besides weekends. Administrators keep it: one drafts adding or removing a future
 * holiday, and it takes effect when a second approves it. Past days are never changed, so an
 * SLA already measured stays as it was measured.
 */
export const HolidayChangeAction = {
  Add: "ADD",
  Remove: "REMOVE",
} as const;
export type HolidayChangeAction = (typeof HolidayChangeAction)[keyof typeof HolidayChangeAction];

/** A non-working day in the calendar. */
export interface HolidayView {
  /** Manila calendar date, YYYY-MM-DD. */
  date: string;
  name: string;
}

/** A drafted change, waiting for a second administrator. */
export interface HolidayChangeView {
  id: string;
  action: HolidayChangeAction;
  date: string;
  /** The holiday's name: the one to add, or the one being removed. */
  name: string;
  reason: string;
  requestedByName: string;
  requestedAt: string;
  allowedActions: {
    /** Approve it (drafted by someone else). */
    approve: boolean;
    /** Reject it (any administrator; the drafter may withdraw their own). */
    reject: boolean;
    /** Why approving is not offered. */
    approveBlockedReason: string | null;
  };
}

/** The calendar as administrators see it. */
export interface BusinessCalendarView {
  /** Today in Manila (YYYY-MM-DD): only later days can be changed. */
  today: string;
  holidays: HolidayView[];
  pending: HolidayChangeView[];
}

export interface HolidayChangeRequest {
  action: HolidayChangeAction;
  date: string;
  /** Required to add a holiday; ignored when removing one. */
  name?: string;
  reason: string;
}

export interface HolidayChangeDecisionRequest {
  note?: string;
}
