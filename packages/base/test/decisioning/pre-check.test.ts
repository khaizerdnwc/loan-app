import {
  CURRENT_RULE_SET,
  type PreCheckInputs,
  preCheck,
  RULE_SETS,
  type RuleSet,
} from "../../src/decisioning/engine";

/** The registry is read-only in production code; a test may register a variant briefly. */
const RULE_SETS_FOR_TEST = RULE_SETS as Record<string, RuleSet>;

const maria: PreCheckInputs = {
  productCode: "PL",
  amount: "150000.00",
  tenorMonths: 24,
  ageYears: 31,
  monthlyIncome: "78000.00",
  monthlyObligations: "9000.00",
};
const at = (patch: Partial<PreCheckInputs>) => preCheck({ ...maria, ...patch }, CURRENT_RULE_SET);
const check = (r: ReturnType<typeof preCheck>, id: string) => r.checks.find((c) => c.id === id);

describe("EL-1 the eligibility pre-check (PRD PC-008): policy checks with no provider", () => {
  it("Maria's figures are likely eligible, affordable at every grade's rate", () => {
    const r = at({});
    expect(r).toMatchObject({
      ruleSetVersion: CURRENT_RULE_SET,
      outcome: "LIKELY_ELIGIBLE",
      monthlyRateRange: { from: "0.0120", to: "0.0200" },
      affordable: { atBestRate: "150000.00", atWorstRate: "150000.00" },
    });
    expect(r.checks.every((c) => c.result === "PASS")).toBe(true);
  });

  it("an age outside policy is not eligible", () => {
    for (const ageYears of [20, 66]) {
      const r = at({ ageYears });
      expect(r.outcome).toBe("NOT_ELIGIBLE");
      expect(check(r, "PC-AGE")?.result).toBe("FAIL");
    }
    expect(at({ ageYears: 21 }).outcome).toBe("LIKELY_ELIGIBLE");
    expect(at({ ageYears: 65 }).outcome).toBe("LIKELY_ELIGIBLE");
  });

  it("debt-to-income over the cap means a review is likely (compared exactly)", () => {
    // 78,000 × 0.40 = 31,200: at the cap passes, one centavo over goes to review.
    expect(check(at({ monthlyObligations: "31200.00" }), "PC-DTI")?.result).toBe("PASS");
    const over = at({ monthlyObligations: "31200.01" });
    expect(check(over, "PC-DTI")?.result).toBe("REVIEW");
    expect(over.outcome).not.toBe("LIKELY_ELIGIBLE");
  });

  it("an amount above the automatic approval limit means a review is likely", () => {
    const r = at({ amount: "350000.00", monthlyIncome: "180000.00" });
    expect(check(r, "PC-AMOUNT")?.result).toBe("REVIEW");
    expect(r.outcome).toBe("REVIEW_LIKELY");
  });

  it("an amount affordable only at the better grades means a review is likely, with the range", () => {
    // Nico's figures: 4,900 a month left; × 24 ÷ 1.288 = 91,304 → ₱91,000 at 1.20%,
    // ÷ 1.480 = 79,459 → ₱79,000 at 2.00%.
    const r = at({
      amount: "250000.00",
      monthlyIncome: "70000.00",
      monthlyObligations: "30100.00",
    });
    expect(r.affordable).toEqual({ atBestRate: "91000.00", atWorstRate: "79000.00" });
    expect(check(r, "PC-AFFORD")).toMatchObject({
      result: "REVIEW",
      value: "up to 79000.00 at the highest rate",
    });
  });

  it("nothing affordable means review is likely, not a refusal (the decision would refer it)", () => {
    const r = at({ monthlyObligations: "40000.00" });
    expect(r.affordable).toEqual({ atBestRate: "0.00", atWorstRate: "0.00" });
    expect(check(r, "PC-AFFORD")).toMatchObject({ result: "REVIEW", value: "nothing affordable" });
    expect(r.outcome).toBe("REVIEW_LIKELY");
  });

  it("only an age outside policy is not eligible", () => {
    const r = at({ ageYears: 70, monthlyObligations: "40000.00", amount: "400000.00" });
    expect(r.outcome).toBe("NOT_ELIGIBLE");
    expect(r.checks.filter((c) => c.result === "FAIL").map((c) => c.id)).toEqual(["PC-AGE"]);
  });

  it("takes the lowest and highest rate across grades, whatever order the rule set lists them", () => {
    const base = RULE_SETS[CURRENT_RULE_SET] as RuleSet;
    RULE_SETS_FOR_TEST["RS-TEST-ORDER"] = {
      ...base,
      version: "RS-TEST-ORDER",
      monthlyRate: { A: "0.0150", B: "0.0110", C: "0.0210", D: "0.0130", E: "0.0170" },
    };
    try {
      expect(preCheck(maria, "RS-TEST-ORDER").monthlyRateRange).toEqual({
        from: "0.0110",
        to: "0.0210",
      });
    } finally {
      delete RULE_SETS_FOR_TEST["RS-TEST-ORDER"];
    }
  });

  it("an earlier rule set without an affordability policy gives no range", () => {
    expect(preCheck(maria, "RS-PL-2").affordable).toBeNull();
  });

  it("refuses another product's figures for this rule set", () => {
    expect(() => at({ productCode: "HL" })).toThrow(/is for product PL/);
  });
});
