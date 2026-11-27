import type { ReportPeriod } from "@loan/core";
import { validation } from "../cases/domain-error";
import type { Window } from "./reports.repository";

const PH_OFFSET_MS = 8 * 3_600_000;
const DAY_MS = 86_400_000;
/** The default report period: the last 30 business days, today included. */
export const DEFAULT_PERIOD_DAYS = 30;
/** The longest period one report covers. */
export const MAX_PERIOD_DAYS = 366;

/** Today's business date (Philippines, UTC+8). */
function today(now: Date): string {
  return new Date(now.getTime() + PH_OFFSET_MS).toISOString().slice(0, 10);
}

/** Midnight at the start of a business date; refuses an impossible date such as 2026-02-31. */
function dayStart(date: string, field: string): Date {
  const d = new Date(`${date}T00:00:00.000+08:00`);
  const roundTrip = Number.isNaN(d.getTime())
    ? null
    : new Date(d.getTime() + PH_OFFSET_MS).toISOString().slice(0, 10);
  if (roundTrip !== date) {
    throw validation("Check the dates.", [{ field, message: "Enter a real date." }]);
  }
  return d;
}

/**
 * The report period from optional business dates (inclusive): by default the last 30 days.
 * Returns the period as dates and the query window [from, until).
 */
export function reportPeriod(
  from: string | undefined,
  to: string | undefined,
  now = new Date(),
): { period: ReportPeriod; window: Window } {
  const toDate = to ?? today(now);
  const end = new Date(dayStart(toDate, "to").getTime() + DAY_MS);
  const fromDate =
    from ??
    new Date(end.getTime() - DEFAULT_PERIOD_DAYS * DAY_MS + PH_OFFSET_MS)
      .toISOString()
      .slice(0, 10);
  const start = dayStart(fromDate, "from");
  if (start >= end) {
    throw validation("The period ends before it starts.", [
      { field: "to", message: "Choose a date on or after the start date." },
    ]);
  }
  if (end.getTime() - start.getTime() > MAX_PERIOD_DAYS * DAY_MS) {
    throw validation("The period is too long.", [
      { field: "from", message: `Choose at most ${MAX_PERIOD_DAYS} days.` },
    ]);
  }
  return { period: { from: fromDate, to: toDate }, window: { from: start, until: end } };
}

/** A count's share of a whole (`outOf`) as a decimal string with four places ("0.6400"). Counts, not money. */
export function share(count: number, outOf: number): string {
  if (outOf <= 0) return "0.0000";
  const basisPoints = Math.round((count * 10_000) / outOf);
  const whole = Math.floor(basisPoints / 10_000);
  const frac = String(basisPoints % 10_000).padStart(4, "0");
  return `${whole}.${frac}`;
}
