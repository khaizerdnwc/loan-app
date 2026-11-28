import { HolidayChangeAction } from "@loan/core";

/**
 * The rules for changing the business calendar (PRD PLT-005), pure so they are unit-tested on
 * their own. The service checks them when a change is drafted and again when it is approved
 * (a day may have arrived, or the calendar changed, in between).
 */

/** Whether `date` is a real calendar date written YYYY-MM-DD (so 2027-02-30 is not). */
export function isCalendarDate(date: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return false;
  const parsed = new Date(`${date}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === date;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** A YYYY-MM-DD date in words, as the screens show dates: "4 Jan 2027". */
export function wordedDate(date: string): string {
  const [year, month, day] = date.split("-").map(Number);
  return `${day} ${MONTHS[(month ?? 1) - 1]} ${year}`;
}

/** Whether a calendar date falls on a Saturday or a Sunday (already outside business time). */
export function isWeekend(date: string): boolean {
  const weekday = new Date(`${date}T00:00:00.000Z`).getUTCDay();
  return weekday === 0 || weekday === 6;
}

export interface CalendarChangeInput {
  action: HolidayChangeAction;
  date: string;
  /** Manila today, YYYY-MM-DD. */
  today: string;
  /** The holiday on that date now, if any. */
  existing: { name: string } | null;
}

export type CalendarRefusal =
  | { kind: "field"; field: "date"; message: string }
  | { kind: "state"; message: string };

/**
 * Why this change cannot be made now, or null when it can. Only days after today change:
 * today's business time is already running, and past days were already measured.
 */
export function calendarRefusal(input: CalendarChangeInput): CalendarRefusal | null {
  const { action, date, today, existing } = input;
  if (!isCalendarDate(date)) {
    return { kind: "field", field: "date", message: "Enter a real date, YYYY-MM-DD." };
  }
  if (date <= today) {
    return {
      kind: "field",
      field: "date",
      message: "Only days after today can change; past and current days were already measured.",
    };
  }
  if (action === HolidayChangeAction.Add) {
    if (isWeekend(date)) {
      return {
        kind: "field",
        field: "date",
        message: "That day is a Saturday or a Sunday, already outside business time.",
      };
    }
    if (existing) {
      return {
        kind: "state",
        message: `${wordedDate(date)} is already a holiday (${existing.name}).`,
      };
    }
    return null;
  }
  if (!existing) {
    return { kind: "state", message: `${wordedDate(date)} is not a holiday in the calendar.` };
  }
  return null;
}
