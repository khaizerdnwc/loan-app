import {
  formatAmountsInText,
  formatDate,
  formatMonthlyRate,
  formatNumber,
  formatPeso,
  formatRatioPercent,
  formatSeconds,
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

describe("formatAmountsInText — amounts in the API's sentences read like every other amount", () => {
  it.each([
    [
      "Created draft APP-1001: ₱200000.00 over 36 months for Joel Reyes.",
      "Created draft APP-1001: ₱200,000.00 over 36 months for Joel Reyes.",
    ],
    [
      "Booked loan LN-2026-001001 (₱150000.00 + ₱43200.00 interest, 24 instalments) and disbursed ₱150000.00 to WB-SAV-0021-4410 (DSB-00000001).",
      "Booked loan LN-2026-001001 (₱150,000.00 + ₱43,200.00 interest, 24 instalments) and disbursed ₱150,000.00 to WB-SAV-0021-4410 (DSB-00000001).",
    ],
    [
      "₱120000.00 is above your approval limit of ₱100000.00",
      "₱120,000.00 is above your approval limit of ₱100,000.00",
    ],
    ["limit 300000.00", "limit ₱300,000.00"],
    ["Approved ₱20000 today", "Approved ₱20,000.00 today"],
  ])("%s", (input, expected) => {
    expect(formatAmountsInText(input)).toBe(expected);
  });

  it.each([
    "Amount must be between ₱20,000 and ₱500,000.",
    "DTI 19.6%",
    "score 612 (C)",
    "Approved at 1.60% a month (grade C).",
    "envelope ENV-00000001",
    "key bk-7680665e-5505-4f90-8efe-24ef25eaa55c",
    "Declined (D01).",
  ])("leaves %s alone", (text) => {
    expect(formatAmountsInText(text)).toBe(text);
  });

  it("returns an empty string for nothing", () => {
    expect(formatAmountsInText(null)).toBe("");
    expect(formatAmountsInText(undefined)).toBe("");
  });
});

describe("formatSeconds — one rounding for every latency on screen", () => {
  it.each([
    [0, "0.0 s"],
    [420, "0.4 s"],
    [1234, "1.2 s"],
    [1850, "1.9 s"],
    [60_000, "60.0 s"],
  ])("%d ms reads %s", (ms, text) => {
    expect(formatSeconds(ms)).toBe(text);
  });

  it("shows a dash when there is no measurement", () => {
    expect(formatSeconds(null)).toBe("—");
    expect(formatSeconds(undefined)).toBe("—");
  });
});
