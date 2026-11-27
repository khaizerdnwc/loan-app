import { formatPeso } from "@loan/ui";
import { z } from "zod";

/**
 * The new-application form's rules — the same limits the API enforces for the personal
 * loan (₱20,000–₱500,000, 6–36 whole months, purpose required; docs/ASSUMPTIONS.md). The
 * API is the authority; this only saves a round trip. Amounts are compared as whole
 * centavos (BigInt), never as floats.
 */
export const MIN_AMOUNT = "20000.00";
export const MAX_AMOUNT = "500000.00";
export const MIN_TENOR = 6;
export const MAX_TENOR = 36;

const DIGITS = /^\d+$/;
/** Commas only as thousands separators: "150,000" yes, "1,2,3" no. */
function isGrouped(input: string): boolean {
  const [whole = ""] = input.split(".");
  const [first = "", ...rest] = whole.split(",");
  return /^\d{1,3}$/.test(first) && rest.every((g) => /^\d{3}$/.test(g));
}

function isAmount(input: string): boolean {
  const parts = input.split(".");
  if (parts.length > 2) return false;
  const [whole = "", fraction] = parts;
  if (!DIGITS.test(whole) || whole.length > 12) return false;
  return fraction === undefined || (DIGITS.test(fraction) && fraction.length <= 2);
}

/** "150,000.5" → 15000050n centavos, or null when it is not an amount. */
export function toCentavos(input: string): bigint | null {
  const trimmed = input.trim();
  if (trimmed.includes(",") && !isGrouped(trimmed)) return null;
  const cleaned = trimmed.replaceAll(",", "");
  if (!isAmount(cleaned)) return null;
  const [whole = "0", fraction = ""] = cleaned.split(".");
  return BigInt(whole) * 100n + BigInt(fraction.padEnd(2, "0"));
}

/** Normalise "150,000.5" to the API's decimal string "150000.50". */
export function toDecimalString(input: string): string {
  const centavos = toCentavos(input);
  if (centavos === null) return input;
  const whole = centavos / 100n;
  const cents = (centavos % 100n).toString().padStart(2, "0");
  return `${whole}.${cents}`;
}

export const applicationSchema = z.object({
  applicantId: z.string().min(1, "Choose the applicant."),
  amount: z
    .string()
    .min(1, "Enter the amount.")
    .refine((v) => toCentavos(v) !== null, "Enter an amount in pesos, e.g. 150000 or 150000.50.")
    .refine(
      (v) => {
        const c = toCentavos(v);
        return (
          c === null || (c >= (toCentavos(MIN_AMOUNT) ?? 0n) && c <= (toCentavos(MAX_AMOUNT) ?? 0n))
        );
      },
      `The amount must be between ${formatPeso(MIN_AMOUNT)} and ${formatPeso(MAX_AMOUNT)}.`,
    ),
  tenorMonths: z
    .string()
    .min(1, "Enter the tenor.")
    .refine((v) => /^\d+$/.test(v.trim()), "Enter a whole number of months.")
    .refine((v) => {
      const n = Number.parseInt(v, 10);
      return n >= MIN_TENOR && n <= MAX_TENOR;
    }, `The tenor must be ${MIN_TENOR} to ${MAX_TENOR} months.`),
  purpose: z
    .string()
    .trim()
    .min(3, "Enter the purpose of the loan.")
    .max(120, "Keep the purpose under 120 characters."),
});

export type ApplicationForm = z.infer<typeof applicationSchema>;
