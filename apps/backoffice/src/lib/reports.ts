/** The report periods a screen offers, in days back from today (today included). */
export const PERIODS = [
  { value: "7", label: "7 days" },
  { value: "30", label: "30 days" },
  { value: "90", label: "90 days" },
] as const;
export type PeriodDays = (typeof PERIODS)[number]["value"];

const PH_OFFSET_MS = 8 * 3_600_000;
const DAY_MS = 86_400_000;

/** The `?from=&to=` query for the last `days` business days (Philippines, UTC+8). */
export function periodQuery(days: number, now = new Date()): string {
  const today = new Date(now.getTime() + PH_OFFSET_MS);
  const from = new Date(today.getTime() - (days - 1) * DAY_MS);
  return `?from=${from.toISOString().slice(0, 10)}&to=${today.toISOString().slice(0, 10)}`;
}

/** A share string such as "0.6400" as "64%" ("64.5%" when it has a fraction). */
export function percent(share: string): string {
  const [whole = "0", frac = "0000"] = share.split(".");
  const basisPoints = Number(whole) * 10_000 + Number(frac.padEnd(4, "0").slice(0, 4));
  const tenths = Math.round(basisPoints / 10);
  return tenths % 10 === 0 ? `${tenths / 10}%` : `${Math.floor(tenths / 10)}.${tenths % 10}%`;
}
