import { Money } from "@loan/core";
import { addMonths, buildSchedule, quote } from "./schedule";

const terms = (principal: string, monthlyRate: string, tenorMonths: number) => ({
  principal: Money.of(principal),
  monthlyRate,
  tenorMonths,
});

describe("quote — add-on interest (ADR 0019 R3, R4)", () => {
  it("F1: ₱150,000 at grade A (1.20%/month) over 24 months", () => {
    const q = quote(terms("150000", "0.0120", 24));
    expect(q.interest.toString()).toBe("43200.00");
    expect(q.totalRepayable.toString()).toBe("193200.00");
    expect(q.regularInstalment.toString()).toBe("8050.00");
    expect(q.finalInstalment.toString()).toBe("8050.00");
  });

  it("F2: ₱120,000 at grade C (1.60%/month) over 36 months", () => {
    const q = quote(terms("120000", "0.0160", 36));
    expect(q.interest.toString()).toBe("69120.00");
    expect(q.totalRepayable.toString()).toBe("189120.00");
    expect(q.regularInstalment.toString()).toBe("5253.33");
    // 189,120.00 − 5,253.33 × 35 = 5,253.45: the last instalment absorbs the remainder.
    expect(q.finalInstalment.toString()).toBe("5253.45");
  });

  it("rounds interest half-up once, on the total", () => {
    // 20,000.01 × 0.0125 × 7 = 1,750.000875 → 1,750.00
    expect(quote(terms("20000.01", "0.0125", 7)).interest.toString()).toBe("1750.00");
    // 20,000.05 × 0.0125 × 7 = 1,750.004375 → 1,750.00; 20,000.06 → 1,750.00525 → 1,750.01
    expect(quote(terms("20000.06", "0.0125", 7)).interest.toString()).toBe("1750.01");
  });

  it("refuses a fractional tenor and a non-positive principal", () => {
    expect(() => quote(terms("100000", "0.0120", 12.5))).toThrow(/whole number/);
    expect(() => quote(terms("0", "0.0120", 12))).toThrow(/positive/);
  });
});

describe("buildSchedule — every schedule reconciles exactly (B-4, ADR 0019 R6)", () => {
  const amounts = [
    "20000.00",
    "20000.01",
    "99999.99",
    "120000.00",
    "150000.00",
    "333333.33",
    "500000.00",
  ];
  const rates = ["0.0120", "0.0140", "0.0160", "0.0180", "0.0200"];
  const tenors = [6, 7, 11, 12, 13, 18, 24, 35, 36];

  it.each(amounts.flatMap((a) => rates.flatMap((r) => tenors.map((t) => [a, r, t] as const))))(
    "%s at %s over %i months",
    (amount, rate, tenor) => {
      const t = terms(amount, rate, tenor);
      const q = quote(t);
      const schedule = buildSchedule(t, "2026-11-28");

      expect(schedule).toHaveLength(tenor);
      expect(Money.sum(schedule.map((i) => i.amount)).equals(q.totalRepayable)).toBe(true);
      expect(Money.sum(schedule.map((i) => i.principal)).equals(q.principal)).toBe(true);
      expect(Money.sum(schedule.map((i) => i.interest)).equals(q.interest)).toBe(true);
      expect(q.totalRepayable.equals(q.principal.plus(q.interest))).toBe(true);

      for (const line of schedule) {
        expect(line.amount.isRounded() && line.principal.isRounded()).toBe(true);
        expect(line.interest.isNegative()).toBe(false);
        expect(line.principal.plus(line.interest).equals(line.amount)).toBe(true);
      }
      // The last instalment is never below the others, and only centavos above.
      const last = schedule[tenor - 1]?.amount ?? Money.zero();
      const diff = last.minus(q.regularInstalment);
      expect(diff.isNegative()).toBe(false);
      expect(diff.lessThan(Money.of(String(tenor)).dividedBy(100).plus(Money.of("0.01")))).toBe(
        true,
      );
    },
  );

  it("numbers instalments from 1 and dates them monthly from the booking date", () => {
    const schedule = buildSchedule(terms("150000", "0.0120", 3), "2026-11-28");
    expect(schedule.map((i) => [i.number, i.dueDate])).toEqual([
      [1, "2026-12-28"],
      [2, "2027-01-28"],
      [3, "2027-02-28"],
    ]);
  });
});

describe("addMonths", () => {
  it.each([
    ["2026-01-31", 1, "2026-02-28"],
    ["2028-01-31", 1, "2028-02-29"],
    ["2026-03-31", 1, "2026-04-30"],
    ["2026-11-28", 2, "2027-01-28"],
    ["2026-12-15", 12, "2027-12-15"],
    ["2026-08-31", 36, "2029-08-31"],
  ])("%s + %i months = %s", (date, months, expected) => {
    expect(addMonths(date, months)).toBe(expected);
  });

  it("refuses a date that is not YYYY-MM-DD", () => {
    expect(() => addMonths("28/11/2026", 1)).toThrow(/YYYY-MM-DD/);
  });
});
