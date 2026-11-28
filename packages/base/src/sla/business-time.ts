/**
 * Philippine business time (PRD PLT-005, WF-003): Monday to Friday, 09:00–17:00 Manila time
 * (UTC+8, no daylight saving), less the holidays in the calendar. Pure: the holiday set is
 * passed in, so the arithmetic is unit-tested on its own.
 */

const PH_OFFSET_MS = 8 * 3_600_000;
const DAY_MS = 86_400_000;
const MINUTE_MS = 60_000;

/** The business day, in Manila hours. */
export const BUSINESS_DAY = { startHour: 9, endHour: 17 } as const;
export const BUSINESS_MINUTES_PER_DAY = (BUSINESS_DAY.endHour - BUSINESS_DAY.startHour) * 60;

/** A Manila calendar date (YYYY-MM-DD) for an instant. */
export function manilaDate(t: Date): string {
  return new Date(t.getTime() + PH_OFFSET_MS).toISOString().slice(0, 10);
}

/** Midnight in Manila at the start of the Manila day holding `t`, as an instant (ms). */
function manilaMidnight(t: number): number {
  return Math.floor((t + PH_OFFSET_MS) / DAY_MS) * DAY_MS - PH_OFFSET_MS;
}

/** Whether a Manila day (given by its midnight) is a working day. */
function isWorkingDay(midnight: number, holidays: ReadonlySet<string>): boolean {
  const local = new Date(midnight + PH_OFFSET_MS);
  const weekday = local.getUTCDay(); // 0 Sunday … 6 Saturday, in Manila
  if (weekday === 0 || weekday === 6) return false;
  return !holidays.has(local.toISOString().slice(0, 10));
}

/** The business window [open, close) of a Manila day, as instants (ms). */
function window(midnight: number): [number, number] {
  return [
    midnight + BUSINESS_DAY.startHour * 3_600_000,
    midnight + BUSINESS_DAY.endHour * 3_600_000,
  ];
}

/** Whole business minutes between two instants (0 when `to` is not after `from`). */
export function businessMinutesBetween(
  from: Date,
  to: Date,
  holidays: ReadonlySet<string>,
): number {
  const start = from.getTime();
  const end = to.getTime();
  if (end <= start) return 0;
  let ms = 0;
  for (let day = manilaMidnight(start); day < end; day += DAY_MS) {
    if (!isWorkingDay(day, holidays)) continue;
    const [open, close] = window(day);
    const a = Math.max(open, start);
    const b = Math.min(close, end);
    if (b > a) ms += b - a;
  }
  return Math.floor(ms / MINUTE_MS);
}

/** The instant `minutes` business minutes after `from` (when an SLA target falls due). */
export function addBusinessMinutes(
  from: Date,
  minutes: number,
  holidays: ReadonlySet<string>,
): Date {
  let left = minutes * MINUTE_MS;
  let cursor = from.getTime();
  for (let day = manilaMidnight(cursor); ; day += DAY_MS) {
    if (!isWorkingDay(day, holidays)) continue;
    const [open, close] = window(day);
    const a = Math.max(open, cursor);
    if (a >= close) continue;
    if (close - a >= left) return new Date(a + left);
    left -= close - a;
    cursor = close;
  }
}
