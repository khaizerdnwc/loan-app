import Decimal from "decimal.js";

/**
 * Exact money (ADR 0019). A Money wraps a decimal.js value; arithmetic never goes through a
 * JavaScript number. Intermediate results may carry more than two decimal places (interest
 * before rounding); a value is only rounded to the centavo when `round()` is called with an
 * explicit mode, and `toString()` refuses a value that has not been rounded, so an
 * unrounded amount can never reach the database or the API by accident.
 */
const D = Decimal.clone({
  precision: 40,
  rounding: Decimal.ROUND_HALF_UP,
  toExpNeg: -40,
  toExpPos: 40,
});
type Dec = InstanceType<typeof D>;

/**
 * How to round to the centavo, named after the rule in ADR 0019, not after decimal.js.
 * `DOWN` truncates towards zero. ADR 0019 calls it "floor to the centavo"; the two agree for
 * the non-negative amounts the schedule rounds, which are the only values it is used on.
 */
export type RoundingMode = "HALF_UP" | "DOWN";

const MODE: Record<RoundingMode, Decimal.Rounding> = {
  HALF_UP: Decimal.ROUND_HALF_UP,
  DOWN: Decimal.ROUND_DOWN,
};

const DIGITS = /^\d+$/;

/**
 * A decimal string: optional minus (when `signed`), up to `maxWhole` integer digits, and
 * up to `maxScale` decimals. Checked by splitting rather than with one nested regex.
 */
function isDecimalString(
  input: string,
  signed: boolean,
  maxWhole: number,
  maxScale: number,
): boolean {
  const body = signed && input.startsWith("-") ? input.slice(1) : input;
  const parts = body.split(".");
  if (parts.length > 2) return false;
  const [whole = "", fraction] = parts;
  if (!DIGITS.test(whole) || whole.length > maxWhole) return false;
  if (fraction === undefined) return true;
  return DIGITS.test(fraction) && fraction.length <= maxScale;
}

/**
 * Money is stored as numeric(MONEY_PRECISION, MONEY_SCALE) (ADR 0019 R2): at most 12 whole
 * digits. The column transformer uses the same constants, so an amount that parses here
 * always fits the column, and an oversized value is a validation error, not a 500.
 */
export const MONEY_PRECISION = 14;
export const MONEY_SCALE = 2;
const MAX_WHOLE_DIGITS = MONEY_PRECISION - MONEY_SCALE;

/** An amount: at most 12 whole digits and two decimal places ("150000", "-12.34"). */
const isMoneyString = (s: string) => isDecimalString(s, true, MAX_WHOLE_DIGITS, MONEY_SCALE);
/** A non-negative decimal factor such as a monthly rate ("0.0120"). */
const isFactorString = (s: string) => isDecimalString(s, false, 20, 20);

export class MoneyError extends Error {
  readonly code = "INVALID_MONEY";
}

export class Money {
  private constructor(private readonly value: Dec) {}

  /** Parse an amount from its decimal string form (the only form the API accepts). */
  static of(input: string): Money {
    if (typeof input !== "string" || !isMoneyString(input.trim())) {
      throw new MoneyError(
        `"${String(input)}" is not an amount: use a decimal string with at most 2 decimal places`,
      );
    }
    return new Money(new D(input.trim()));
  }

  /** Whole pesos from an integer (seed data, product limits). */
  static pesos(whole: number): Money {
    if (!Number.isSafeInteger(whole) || String(Math.abs(whole)).length > MAX_WHOLE_DIGITS) {
      throw new MoneyError(
        `${whole} is not a whole number of pesos that fits ${MAX_WHOLE_DIGITS} digits`,
      );
    }
    return new Money(new D(whole));
  }

  static zero(): Money {
    return new Money(new D(0));
  }

  static sum(values: readonly Money[]): Money {
    return values.reduce((acc, m) => acc.plus(m), Money.zero());
  }

  plus(other: Money): Money {
    return new Money(this.value.plus(other.value));
  }

  minus(other: Money): Money {
    return new Money(this.value.minus(other.value));
  }

  /**
   * Multiply by a factor: a rate as a decimal string ("0.0120"), or a whole number (a count
   * of months). A fractional JavaScript number is refused — it is already inexact.
   */
  times(factor: string | number): Money {
    return new Money(this.value.times(toFactor(factor)));
  }

  /** Divide by a whole, positive number (a count of instalments). */
  dividedBy(divisor: number): Money {
    if (!Number.isSafeInteger(divisor) || divisor <= 0) {
      throw new MoneyError(`cannot divide money by ${divisor}: use a whole number above zero`);
    }
    return new Money(this.value.dividedBy(divisor));
  }

  /** Round to the centavo with an explicit mode (ADR 0019). */
  round(mode: RoundingMode): Money {
    return new Money(this.value.toDecimalPlaces(MONEY_SCALE, MODE[mode]));
  }

  isRounded(): boolean {
    return this.value.decimalPlaces() <= MONEY_SCALE;
  }

  equals(other: Money): boolean {
    return this.value.equals(other.value);
  }

  compare(other: Money): -1 | 0 | 1 {
    return this.value.comparedTo(other.value) as -1 | 0 | 1;
  }

  greaterThan(other: Money): boolean {
    return this.value.greaterThan(other.value);
  }

  greaterThanOrEqual(other: Money): boolean {
    return this.value.greaterThanOrEqualTo(other.value);
  }

  lessThan(other: Money): boolean {
    return this.value.lessThan(other.value);
  }

  lessThanOrEqual(other: Money): boolean {
    return this.value.lessThanOrEqualTo(other.value);
  }

  isZero(): boolean {
    return this.value.isZero();
  }

  isNegative(): boolean {
    return this.value.isNegative() && !this.value.isZero();
  }

  /** This amount as a fraction of another, as a decimal string (DTI ratios). */
  ratioTo(other: Money, decimalPlaces = 4): string {
    if (other.isZero()) throw new MoneyError("cannot take a ratio to zero");
    return this.value
      .dividedBy(other.value)
      .toDecimalPlaces(decimalPlaces, Decimal.ROUND_HALF_UP)
      .toFixed(decimalPlaces);
  }

  /** The canonical form: exactly two decimal places. Refuses an unrounded value. */
  toString(): string {
    if (!this.isRounded()) {
      throw new MoneyError(
        `${this.value.toFixed()} has more than 2 decimal places: call round() first`,
      );
    }
    if (this.value.abs().greaterThanOrEqualTo(new D(10).pow(MAX_WHOLE_DIGITS))) {
      throw new MoneyError(
        `${this.value.toFixed(2)} does not fit numeric(${MONEY_PRECISION},${MONEY_SCALE})`,
      );
    }
    return this.value.toFixed(MONEY_SCALE);
  }

  /** Full precision, for intermediate values in logs of a calculation. Never stored. */
  toPreciseString(): string {
    return this.value.toFixed();
  }

  toJSON(): string {
    return this.toString();
  }
}

function toFactor(factor: string | number): Dec {
  if (typeof factor === "number") {
    if (!Number.isSafeInteger(factor)) {
      throw new MoneyError(
        `${factor} is not exact: pass a rate as a decimal string such as "0.0120"`,
      );
    }
    return new D(factor);
  }
  if (!isFactorString(factor)) throw new MoneyError(`"${factor}" is not a decimal factor`);
  return new D(factor);
}
