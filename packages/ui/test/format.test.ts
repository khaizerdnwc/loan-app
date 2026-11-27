import {
  formatDate,
  formatMonthlyRate,
  formatNumber,
  formatPeso,
  formatRatioPercent,
} from "../src/lib/format";

describe("formatPeso — formats the decimal string itself, never a float", () => {
  it.each([
    ["150000.00", "₱150,000.00"],
    ["5253.45", "₱5,253.45"],
    ["999999999999.99", "₱999,999,999,999.99"],
    ["0.10", "₱0.10"],
    ["20000", "₱20,000.00"],
    ["1234.5", "₱1,234.50"],
    ["100", "₱100.00"],
    ["-12.34", "−₱12.34"],
  ])("%s → %s", (input, expected) => {
    expect(formatPeso(input)).toBe(expected);
  });

  it("keeps centavos exactly as sent (no rounding through a number)", () => {
    // 0.1 + 0.2 style drift would show here if the value went through parseFloat.
    expect(formatPeso("9007199254740993.01")).toBe("₱9,007,199,254,740,993.01");
  });

  it("shows a dash for a missing value and returns anything unparseable unchanged", () => {
    expect(formatPeso(null)).toBe("—");
    expect(formatPeso("")).toBe("—");
    expect(formatPeso("abc")).toBe("abc");
  });
});

describe("other formatters", () => {
  it("groups whole numbers", () => {
    expect(formatNumber(1234567)).toBe("1,234,567");
    expect(formatNumber(null)).toBe("—");
  });

  it("shows a ratio as a percent with one decimal", () => {
    expect(formatRatioPercent("0.4300")).toBe("43.0%");
    expect(formatRatioPercent("0.1154")).toBe("11.5%");
    expect(formatRatioPercent(null)).toBe("—");
  });

  it("never cuts a third decimal: such a value is shown as given", () => {
    expect(formatPeso("1.239")).toBe("1.239");
    expect(formatPeso("1.2")).toBe("₱1.20");
  });

  it("shows a monthly add-on rate", () => {
    expect(formatMonthlyRate("0.0160")).toBe("1.60% / month");
    expect(formatMonthlyRate("0.0120")).toBe("1.20% / month");
  });

  it("formats a calendar date without shifting the day", () => {
    expect(formatDate("2026-12-28")).toMatch(/28/);
    expect(formatDate("2026-12-28")).toMatch(/2026/);
    expect(formatDate(null)).toBe("—");
  });
});
