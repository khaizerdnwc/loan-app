/**
 * The one place amounts, numbers and dates are formatted for display
 * (house/money-through-formatter). The API sends money as decimal strings ("150000.00");
 * this formats the string itself — grouping the whole part and keeping the two decimals
 * exactly as sent — so no amount ever passes through a JavaScript number on its way to the
 * screen.
 */

const PESO = "₱";

function groupThousands(whole: string): string {
  const groups: string[] = [];
  for (let end = whole.length; end > 0; end -= 3) {
    groups.unshift(whole.slice(Math.max(0, end - 3), end));
  }
  return groups.join(",") || "0";
}

/**
 * "150000.00" → "₱150,000.00"; "-12.5" → "−₱12.50"; null/empty → "—". The API always sends
 * centavos; a value with more than two decimals is shown as given, never silently cut.
 */
export function formatPeso(value: string | null | undefined): string {
  if (value === null || value === undefined || value.trim() === "") return "—";
  const trimmed = value.trim();
  const negative = trimmed.startsWith("-");
  const body = negative ? trimmed.slice(1) : trimmed;
  const [whole = "0", fraction = ""] = body.split(".");
  if (!/^\d+$/.test(whole) || (fraction !== "" && !/^\d{1,2}$/.test(fraction))) return value;
  const cents = `${fraction}00`.slice(0, 2);
  return `${negative ? "−" : ""}${PESO}${groupThousands(whole)}.${cents}`;
}

/*
 * Amounts inside sentences the API wrote (activity summaries, rule values, problem details):
 *   "₱20000.00"   a peso sign before an ungrouped decimal          → "₱20,000.00"
 *   "300000.00"   a bare decimal of 4+ digits with exactly 2 decimals → "₱300,000.00"
 * Already grouped amounts ("₱20,000"), percentages ("19.6%"), scores and references
 * ("APP-1001", "DSB-00000001", "LN-2026-001001") are left alone.
 */
const PESO_DECIMAL_IN_TEXT = /₱(\d+\.\d{1,2})(?![\d,.])/g;
const PESO_WHOLE_IN_TEXT = /₱(\d+)(?![\d,.])/g;
const BARE_AMOUNT_IN_TEXT = /(?<![\w.,₱-])(\d{4,}\.\d{2})(?![\d%.,\w])/g;

/**
 * Every amount in a server-written sentence through formatPeso, so history entries, rule values
 * and refusals read "₱20,000.00" like the rest of the screen. Stored history is fixed too:
 * the sentence is formatted when shown, not when written.
 */
export function formatAmountsInText(text: string | null | undefined): string {
  if (!text) return "";
  return text
    .replace(PESO_DECIMAL_IN_TEXT, (_, amount: string) => formatPeso(amount))
    .replace(PESO_WHOLE_IN_TEXT, (_, amount: string) => formatPeso(amount))
    .replace(BARE_AMOUNT_IN_TEXT, (_, amount: string) => formatPeso(amount));
}

/** Whole numbers with grouping: 1234567 → "1,234,567". */
export function formatNumber(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  return new Intl.NumberFormat("en-PH", { maximumFractionDigits: 0 }).format(value);
}

/** A ratio string such as "0.4300" as "43.0%". */
export function formatRatioPercent(ratio: string | null | undefined): string {
  if (!ratio) return "—";
  const [whole = "0", fraction = ""] = ratio.split(".");
  const digits = `${whole}${fraction.padEnd(4, "0").slice(0, 4)}`;
  const tenths = Math.round(Number.parseInt(digits, 10) / 10);
  return `${Math.floor(tenths / 10)}.${tenths % 10}%`;
}

/** A monthly add-on rate "0.0160" as "1.60% / month". */
export function formatMonthlyRate(rate: string | null | undefined): string {
  if (!rate) return "—";
  const [whole = "0", fraction = ""] = rate.split(".");
  const basisPoints = Number.parseInt(`${whole}${fraction.padEnd(4, "0").slice(0, 4)}`, 10);
  return `${(basisPoints / 100).toFixed(2)}% / month`;
}

const DATE = new Intl.DateTimeFormat("en-PH", { day: "numeric", month: "short", year: "numeric" });
const DATE_TIME = new Intl.DateTimeFormat("en-PH", {
  day: "numeric",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
});

/** "2026-12-28" or an ISO date-time → "28 Dec 2026". */
export function formatDate(value: string | null | undefined): string {
  if (!value) return "—";
  const date = /^\d{4}-\d{2}-\d{2}$/.test(value) ? new Date(`${value}T00:00:00`) : new Date(value);
  return Number.isNaN(date.getTime()) ? value : DATE.format(date);
}

/** An ISO date-time → "28 Nov, 09:12". */
export function formatDateTime(value: string | null | undefined): string {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : DATE_TIME.format(date);
}
