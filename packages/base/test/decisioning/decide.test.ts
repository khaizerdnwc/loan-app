import {
  bandFor,
  CURRENT_RULE_SET,
  CURRENT_SCORECARD,
  canonicalJson,
  type DecisionInputs,
  decide,
  gradeFor,
  hashInputs,
  REASONS,
  RULE_SETS,
  type RuleSet,
  ruleSet,
  scorecard,
} from "../../src/decisioning/engine";
import { ratioAsPercent } from "../../src/decisioning/engine/ratio";
import {
  CARMEN_LOW_SCORE,
  JOEL_F2,
  MARIA_F1,
  NICO_HIGH_DTI,
  NINA_NO_HIT,
  RAFAEL_ABOVE_LIMIT,
  RAMON_SANCTIONS,
} from "./personas";

const V = { ruleSet: CURRENT_RULE_SET, scorecard: CURRENT_SCORECARD };
/** The registry is read-only in production code; a test may register a variant briefly. */
const RULE_SETS_FOR_TEST = RULE_SETS as Record<string, RuleSet>;
const codes = (inputs: DecisionInputs) => decide(inputs, V).reasonCodes.map((r) => r.code);
const rule = (inputs: DecisionInputs, id: string) =>
  decide(inputs, V).ruleResults.find((r) => r.id === id);

describe("F1-1 — Maria Santos is auto-approved", () => {
  const result = decide(MARIA_F1, V);

  it("scores 742, grade A, in the approve band, with no referral trigger", () => {
    expect(result.outcome).toBe("AUTO_APPROVE");
    expect(result.score).toBe(742);
    expect(result.grade).toBe("A");
    expect(result.referralTriggers).toEqual([]);
    expect(result.reasonCodes).toEqual([]);
  });

  it("passes every rule and prices at the grade A rate", () => {
    expect(result.ruleResults.every((r) => r.result === "PASS")).toBe(true);
    expect(result.monthlyRate).toBe("0.0120");
    expect(result.debtToIncome).toBe("0.1154");
  });

  it("explains the score: the contributions add up to it", () => {
    const sum = result.scoreContributions.reduce((s, c) => s + c.points, 0);
    expect(sum).toBe(742);
  });
});

describe("F2-1 — Joel Reyes is referred", () => {
  const result = decide(JOEL_F2, V);

  it("scores 612, grade C, and is referred for the thin file and the score band", () => {
    expect(result.outcome).toBe("REFER");
    expect(result.score).toBe(612);
    expect(result.grade).toBe("C");
    expect(result.reasonCodes.map((r) => r.code)).toEqual(["R01", "R06"]);
    expect(result.referralTriggers).toHaveLength(2);
  });

  it("records the failing referral rules with what was measured", () => {
    expect(rule(JOEL_F2, "RF-FILE")).toMatchObject({ result: "FAIL", value: "thin file" });
    expect(rule(JOEL_F2, "SC-BAND")).toMatchObject({ result: "FAIL", value: "score 612 (C)" });
  });
});

describe("knockouts run first and end the pipeline (D-1, D-2, D-3)", () => {
  it.each([20, 66])("age %i declines with the age reason and no score", (ageYears) => {
    const inputs = { ...MARIA_F1, applicant: { ...MARIA_F1.applicant, ageYears } };
    const r = decide(inputs, V);
    expect(r.outcome).toBe("AUTO_DECLINE");
    expect(r.score).toBeNull();
    expect(r.reasonCodes.map((c) => c.code)).toEqual(["R09"]);
  });

  it.each([21, 65])("age %i is inside the policy", (ageYears) => {
    const inputs = { ...MARIA_F1, applicant: { ...MARIA_F1.applicant, ageYears } };
    expect(rule(inputs, "KO-AGE")?.result).toBe("PASS");
  });

  it("a sanctions match declines without a score (Ramon Cruz)", () => {
    const r = decide(RAMON_SANCTIONS, V);
    expect(r.outcome).toBe("AUTO_DECLINE");
    expect(r.score).toBeNull();
    expect(r.reasonCodes.map((c) => c.code)).toEqual(["R11"]);
    expect(r.scoreContributions).toEqual([]);
  });

  it("an existing default declines", () => {
    const inputs: DecisionInputs = {
      ...MARIA_F1,
      bureau: {
        ...(MARIA_F1.bureau as Extract<DecisionInputs["bureau"], { status: "OK" }>),
        existingDefault: true,
      },
    };
    expect(decide(inputs, V).outcome).toBe("AUTO_DECLINE");
    expect(codes(inputs)).toEqual(["R12"]);
  });

  it("identity not verified declines", () => {
    const inputs: DecisionInputs = {
      ...MARIA_F1,
      screening: { status: "OK", sanctionsMatch: false, kycVerified: false },
    };
    expect(codes(inputs)).toEqual(["R14"]);
  });

  it("a knockout wins over an excellent score", () => {
    const inputs = { ...RAFAEL_ABOVE_LIMIT, screening: RAMON_SANCTIONS.screening };
    expect(decide(inputs, V).outcome).toBe("AUTO_DECLINE");
  });
});

describe("score bands and referral triggers (D-4, D-5, D-6, D-7)", () => {
  it("a decline-band score with a referral trigger refers, and shows the score as a reason", () => {
    const inputs: DecisionInputs = {
      ...CARMEN_LOW_SCORE,
      application: { ...CARMEN_LOW_SCORE.application, amount: "350000.00", tenorMonths: 36 },
    };
    const r = decide(inputs, V);
    expect(r.outcome).toBe("REFER");
    expect(r.reasonCodes.map((c) => c.code)).toEqual(["R05", "R07", "R04"]);
  });

  it("a rule set that declines low scores even with a trigger does so (the policy is versioned)", () => {
    const strict = {
      ...ruleSet(CURRENT_RULE_SET),
      version: "RS-TEST",
      lowScoreWithTrigger: "DECLINE" as const,
    };
    RULE_SETS_FOR_TEST["RS-TEST"] = strict;
    try {
      const inputs: DecisionInputs = {
        ...CARMEN_LOW_SCORE,
        application: { ...CARMEN_LOW_SCORE.application, amount: "350000.00", tenorMonths: 36 },
      };
      expect(decide(inputs, { ruleSet: "RS-TEST", scorecard: CURRENT_SCORECARD }).outcome).toBe(
        "AUTO_DECLINE",
      );
    } finally {
      delete RULE_SETS_FOR_TEST["RS-TEST"];
    }
  });

  it("a score below 600 declines with reason codes for the score and its causes", () => {
    const r = decide(CARMEN_LOW_SCORE, V);
    expect(r.outcome).toBe("AUTO_DECLINE");
    expect(r.score).toBe(450);
    expect(r.grade).toBe("E");
    expect(r.reasonCodes.map((c) => c.code)).toEqual(["R07", "R04"]);
  });

  it("DTI above 40% refers (Nico Villareal, 43%, 602 C)", () => {
    const r = decide(NICO_HIGH_DTI, V);
    expect(r.outcome).toBe("REFER");
    expect(r.score).toBe(602);
    expect(r.grade).toBe("C");
    expect(r.debtToIncome).toBe("0.4300");
    expect(r.reasonCodes.map((c) => c.code)).toEqual(["R02", "R06"]);
    expect(rule(NICO_HIGH_DTI, "RF-DTI")).toMatchObject({ result: "FAIL", value: "DTI 43.0%" });
  });

  it("DTI exactly at 40% does not refer", () => {
    const inputs = {
      ...MARIA_F1,
      applicant: { ...MARIA_F1.applicant, monthlyObligations: "31200.00" },
    };
    expect(rule(inputs, "RF-DTI")?.result).toBe("PASS");
  });

  it("an amount above ₱300,000 refers even with a grade A score (Rafael Gomez)", () => {
    const r = decide(RAFAEL_ABOVE_LIMIT, V);
    expect(r.outcome).toBe("REFER");
    expect(r.grade).toBe("A");
    expect(r.reasonCodes.map((c) => c.code)).toEqual(["R05"]);
  });

  it("exactly ₱300,000 is within the limit", () => {
    const inputs = { ...MARIA_F1, application: { ...MARIA_F1.application, amount: "300000.00" } };
    expect(decide(inputs, V).outcome).toBe("AUTO_APPROVE");
  });

  it("every decline and referral carries at least one readable reason (D-7)", () => {
    const bureauDown: DecisionInputs = {
      ...MARIA_F1,
      bureau: { status: "UNAVAILABLE", reason: "outage" },
    };
    const screeningDown: DecisionInputs = {
      ...MARIA_F1,
      screening: { status: "UNAVAILABLE", reason: "outage" },
    };
    const kycFailed: DecisionInputs = {
      ...MARIA_F1,
      screening: { status: "OK", sanctionsMatch: false, kycVerified: false },
    };
    const tooOld: DecisionInputs = {
      ...MARIA_F1,
      applicant: { ...MARIA_F1.applicant, ageYears: 66 },
    };
    const defaulted: DecisionInputs = {
      ...MARIA_F1,
      bureau: {
        ...(MARIA_F1.bureau as Extract<DecisionInputs["bureau"], { status: "OK" }>),
        existingDefault: true,
      },
    };
    const seen = new Set<string>();
    for (const p of [
      NINA_NO_HIT,
      tooOld,
      defaulted,
      JOEL_F2,
      RAMON_SANCTIONS,
      NICO_HIGH_DTI,
      RAFAEL_ABOVE_LIMIT,
      CARMEN_LOW_SCORE,
      bureauDown,
      screeningDown,
      kycFailed,
    ]) {
      const r = decide(p, V);
      expect(r.reasonCodes.length).toBeGreaterThan(0);
      for (const reason of r.reasonCodes) {
        seen.add(reason.code);
        expect(reason.staff.length).toBeGreaterThan(10);
        expect(reason.borrower).not.toMatch(/\d/);
      }
    }
    // Every reason code the engine has is reached by this loop: a new code without a
    // case here fails the equality.
    expect([...seen].sort()).toEqual(
      Object.values(REASONS)
        .map((r) => r.code)
        .sort(),
    );
  });
});

describe("provider outages degrade to referral, never decline (B-7, PRD NFR-005)", () => {
  it("with the bureau unavailable, Maria is referred with no score and R10", () => {
    const inputs: DecisionInputs = {
      ...MARIA_F1,
      bureau: { status: "UNAVAILABLE", reason: "timeout after 3000ms" },
    };
    const r = decide(inputs, V);
    expect(r.outcome).toBe("REFER");
    expect(r.score).toBeNull();
    expect(r.reasonCodes.map((c) => c.code)).toEqual(["R10"]);
    expect(rule(inputs, "KO-DEFAULT")?.result).toBe("NOT_EVALUATED");
  });

  it("with screening unavailable, the case is referred, not declined", () => {
    const inputs: DecisionInputs = {
      ...MARIA_F1,
      screening: { status: "UNAVAILABLE", reason: "outage" },
    };
    const r = decide(inputs, V);
    expect(r.outcome).toBe("REFER");
    expect(r.reasonCodes.map((c) => c.code)).toContain("R13");
  });

  it("an outage does not hide a knockout that could still be evaluated", () => {
    const inputs: DecisionInputs = {
      ...MARIA_F1,
      applicant: { ...MARIA_F1.applicant, ageYears: 70 },
      bureau: { status: "UNAVAILABLE", reason: "outage" },
    };
    expect(decide(inputs, V).outcome).toBe("AUTO_DECLINE");
  });
});

describe("reproducibility (D-8, ADR 0022)", () => {
  it("the same inputs and versions always give the same result", () => {
    for (const p of [MARIA_F1, JOEL_F2, NICO_HIGH_DTI, CARMEN_LOW_SCORE]) {
      expect(decide(structuredClone(p), V)).toEqual(decide(p, V));
    }
  });

  it("hashes inputs canonically: key order does not matter, values do", () => {
    const reverseKeys = (v: unknown): unknown =>
      v && typeof v === "object" && !Array.isArray(v)
        ? Object.fromEntries(
            Object.entries(v as Record<string, unknown>)
              .reverse()
              .map(([k, x]) => [k, reverseKeys(x)]),
          )
        : v;
    const reordered = reverseKeys(MARIA_F1) as DecisionInputs;
    expect(Object.keys(reordered)[0]).toBe("bureau");
    expect(hashInputs(reordered)).toBe(hashInputs(MARIA_F1));
    expect(hashInputs({ ...MARIA_F1, asOfDate: "2026-11-29" })).not.toBe(hashInputs(MARIA_F1));
    expect(canonicalJson({ b: 1, a: [2, { d: 3, c: 4 }] })).toBe('{"a":[2,{"c":4,"d":3}],"b":1}');
  });

  it("refuses an unknown version instead of guessing", () => {
    expect(() => decide(MARIA_F1, { ruleSet: "RS-PL-0", scorecard: CURRENT_SCORECARD })).toThrow(
      /rule set/,
    );
    expect(() => decide(MARIA_F1, { ruleSet: CURRENT_RULE_SET, scorecard: "SC-X" })).toThrow(
      /scorecard/,
    );
  });

  it("records the versions it ran with", () => {
    expect(decide(MARIA_F1, V).versions).toEqual(V);
  });
});

describe("ratios are displayed exactly", () => {
  it("formats a ratio as a percent with one decimal, rounding half up", () => {
    expect(ratioAsPercent("0.4300")).toBe("43.0%");
    expect(ratioAsPercent("0.1154")).toBe("11.5%");
    expect(ratioAsPercent("0.11550")).toBe("11.6%");
  });

  it("refuses something that is not a ratio", () => {
    expect(() => ratioAsPercent("-0.1")).toThrow(/ratio/);
    expect(() => ratioAsPercent("1e-2")).toThrow(/ratio/);
  });
});

describe("band and grade edges (qa review: SC-PL-1 scores never land on them)", () => {
  const rs = ruleSet(CURRENT_RULE_SET);
  const sc = scorecard(CURRENT_SCORECARD);

  it.each([
    [599, "DECLINE"],
    [600, "REFER"],
    [699, "REFER"],
    [700, "APPROVE"],
  ] as const)("score %i is in the %s band", (value, band) => {
    expect(bandFor(value, rs)).toBe(band);
  });

  it.each([
    [559, "E"],
    [560, "D"],
    [599, "D"],
    [600, "C"],
    [699, "C"],
    [700, "B"],
    [739, "B"],
    [740, "A"],
  ] as const)("score %i is grade %s", (value, grade) => {
    expect(gradeFor(value, sc)).toBe(grade);
  });

  it("prices every grade at its own rate", () => {
    expect(rs.monthlyRate).toEqual({
      A: "0.0120",
      B: "0.0140",
      C: "0.0160",
      D: "0.0180",
      E: "0.0200",
    });
  });
});

describe("DTI is compared exactly, never as a rounded ratio (data and qa review)", () => {
  const withObligations = (monthlyObligations: string): DecisionInputs => ({
    ...MARIA_F1,
    applicant: { ...MARIA_F1.applicant, monthlyObligations },
  });

  it("₱31,201 on ₱78,000 (40.0013%) is above the cap, though it rounds to 0.4000", () => {
    const inputs = withObligations("31201.00");
    expect(decide(inputs, V).debtToIncome).toBe("0.4000");
    expect(rule(inputs, "RF-DTI")?.result).toBe("FAIL");
    expect(decide(inputs, V).outcome).toBe("REFER");
  });

  it("₱23,399.99 on ₱78,000 (29.99999%) is in the 20–30% band, though it rounds to 0.3000", () => {
    const r = decide(withObligations("23399.99"), V);
    expect(r.debtToIncome).toBe("0.3000");
    expect(r.scoreContributions.find((c) => c.factor === "Debt-to-income")).toMatchObject({
      detail: "20–30%",
      points: 60,
    });
  });

  it("₱15,599.99 on ₱78,000 (19.99999%) is in the under-20% band", () => {
    const r = decide(withObligations("15599.99"), V);
    expect(r.scoreContributions.find((c) => c.factor === "Debt-to-income")?.points).toBe(80);
  });

  it("zero income records no ratio and refers", () => {
    const inputs: DecisionInputs = {
      ...MARIA_F1,
      applicant: { ...MARIA_F1.applicant, monthlyIncome: "0.00" },
    };
    const r = decide(inputs, V);
    expect(r.debtToIncome).toBeNull();
    expect(rule(inputs, "RF-DTI")).toMatchObject({ result: "FAIL", value: "no income" });
    expect(r.outcome).toBe("REFER");
  });
});

describe("a snapshot is only decided under its own product's rule set", () => {
  it("refuses a product the rule set is not for", () => {
    const inputs = { ...MARIA_F1, application: { ...MARIA_F1.application, productCode: "SL" } };
    expect(() => decide(inputs, V)).toThrow(/is for product PL, not SL/);
  });
});

describe("no bureau record (R08)", () => {
  it("refers with R08, scores without a bureau score, and says 'no hit'", () => {
    const r = decide(NINA_NO_HIT, V);
    expect(r.outcome).toBe("REFER");
    expect(r.score).toBe(537);
    expect(r.grade).toBe("E");
    // A trigger refers "regardless of score": the low score becomes a reason, not a decline.
    expect(r.reasonCodes.map((c) => c.code)).toEqual(["R08", "R07"]);
    expect(rule(NINA_NO_HIT, "RF-FILE")).toMatchObject({ result: "FAIL", value: "no hit" });
    expect(r.scoreContributions.find((c) => c.factor === "Bureau score")).toMatchObject({
      detail: "no score",
      points: 60,
    });
    expect(r.scoreContributions.find((c) => c.factor === "Credit file")?.points).toBe(-20);
  });
});
