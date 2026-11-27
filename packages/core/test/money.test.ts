import { Money, MoneyError } from "../src/money";

describe("Money.of — parsing the API's decimal strings", () => {
  it.each([
    ["150000", "150000.00"],
    ["150000.5", "150000.50"],
    ["0.01", "0.01"],
    ["-12.34", "-12.34"],
    [" 20000 ", "20000.00"],
  ])("%s → %s", (input, out) => {
    expect(Money.of(input).toString()).toBe(out);
  });

  it.each(["", "abc", "1.234", "1e5", "1,000", "--1", "1.2.3", ".5", "12345678901234"])(
    "refuses %p",
    (input) => {
      expect(() => Money.of(input)).toThrow(MoneyError);
    },
  );

  it("refuses a non-string (a JSON number would already be a float)", () => {
    expect(() => Money.of(150000 as unknown as string)).toThrow(MoneyError);
  });
});

describe("exact arithmetic", () => {
  it("adds without binary-float drift (0.1 + 0.2 = 0.3)", () => {
    expect(Money.of("0.1").plus(Money.of("0.2")).equals(Money.of("0.3"))).toBe(true);
  });

  it("multiplies by a rate given as a decimal string", () => {
    const interest = Money.of("150000").times("0.012").times(24);
    expect(interest.round("HALF_UP").toString()).toBe("43200.00");
  });

  it("refuses a fractional JavaScript number as a factor", () => {
    expect(() => Money.of("100").times(0.012)).toThrow(/decimal string/);
  });

  it("refuses to divide by anything but a whole positive number", () => {
    expect(() => Money.of("100").dividedBy(0)).toThrow(MoneyError);
    expect(() => Money.of("100").dividedBy(2.5)).toThrow(MoneyError);
  });

  it("sums a list exactly", () => {
    const parts = Array.from({ length: 3 }, () => Money.of("33.33"));
    expect(Money.sum([...parts, Money.of("0.01")]).toString()).toBe("100.00");
  });

  it("computes a ratio as a decimal string (DTI)", () => {
    expect(Money.of("18500").ratioTo(Money.of("70000"))).toBe("0.2643");
    expect(() => Money.of("1").ratioTo(Money.zero())).toThrow(MoneyError);
  });
});

describe("rounding is explicit (ADR 0019)", () => {
  const third = Money.of("100").dividedBy(3); // 33.333…

  it("refuses to serialise an unrounded value", () => {
    expect(third.isRounded()).toBe(false);
    expect(() => third.toString()).toThrow(/round\(\) first/);
    expect(() => JSON.stringify({ amount: third })).toThrow(MoneyError);
  });

  it("rounds half-up", () => {
    // 0.005 and 2.345 cannot be parsed (three decimals); they arise from division.
    expect(Money.of("1").dividedBy(200).round("HALF_UP").toString()).toBe("0.01");
    expect(Money.of("4.69").dividedBy(2).round("HALF_UP").toString()).toBe("2.35");
    expect(third.round("HALF_UP").toString()).toBe("33.33");
  });

  it("rounds down (towards zero) to the centavo", () => {
    expect(Money.of("200").dividedBy(3).round("DOWN").toString()).toBe("66.66");
  });

  it("serialises to JSON as a string, never a number", () => {
    expect(JSON.stringify({ amount: Money.of("150000") })).toBe('{"amount":"150000.00"}');
  });
});

describe("comparison", () => {
  const a = Money.of("100");
  const b = Money.of("100.01");

  it("orders amounts", () => {
    expect(a.lessThan(b)).toBe(true);
    expect(b.greaterThan(a)).toBe(true);
    expect(a.lessThanOrEqual(Money.of("100.00"))).toBe(true);
    expect(b.greaterThanOrEqual(a)).toBe(true);
    expect(a.compare(b)).toBe(-1);
    expect(a.compare(Money.of("100.00"))).toBe(0);
  });

  it("knows zero and negatives", () => {
    expect(Money.zero().isZero()).toBe(true);
    expect(Money.of("-0.01").isNegative()).toBe(true);
    expect(Money.zero().isNegative()).toBe(false);
  });

  it("builds whole pesos only from safe integers", () => {
    expect(Money.pesos(500000).toString()).toBe("500000.00");
    expect(() => Money.pesos(1.5)).toThrow(MoneyError);
  });
});

describe("review follow-ups (qa, data)", () => {
  it.each(["abc", "-0.012", "1e-2", "0.0.1", ""])("refuses the rate string %p", (rate) => {
    expect(() => Money.of("100").times(rate)).toThrow(MoneyError);
  });

  it("subtracts exactly, including below zero", () => {
    expect(Money.of("100.00").minus(Money.of("0.01")).toString()).toBe("99.99");
    expect(Money.of("0.10").minus(Money.of("0.30")).toString()).toBe("-0.20");
  });

  it("rounds DOWN towards zero and HALF_UP away from zero for negatives", () => {
    expect(Money.of("-200").dividedBy(3).round("DOWN").toString()).toBe("-66.66");
    expect(Money.of("-1").dividedBy(200).round("HALF_UP").toString()).toBe("-0.01");
  });

  it("accepts the largest numeric(14,2) amount and refuses one digit more (ADR 0019 R2)", () => {
    expect(Money.of("999999999999.99").toString()).toBe("999999999999.99");
    expect(() => Money.of("1000000000000")).toThrow(MoneyError);
    expect(Money.pesos(999_999_999_999).toString()).toBe("999999999999.00");
    expect(() => Money.pesos(1_000_000_000_000)).toThrow(MoneyError);
  });

  it("refuses to serialise an arithmetic result that no longer fits the column", () => {
    const big = Money.of("999999999999.99").plus(Money.of("0.01"));
    expect(() => big.toString()).toThrow(/numeric\(14,2\)/);
  });
});
