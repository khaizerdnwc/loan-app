import {
  CURRENT_RULE_SET,
  CURRENT_SCORECARD,
  canonicalJson,
  type DecisionInputs,
  decide,
  hashInputs,
} from "../../src/decisioning/engine";
import rsPl3Fixture from "./fixtures/rs-pl-3-records.json";
import {
  asRsPl3,
  CARMEN_LOW_SCORE,
  JOEL_F2,
  MARIA_F1,
  NICO_HIGH_DTI,
  RAMON_SANCTIONS,
} from "./personas";

const V = { ruleSet: CURRENT_RULE_SET, scorecard: CURRENT_SCORECARD };

describe("D-16 PD and recommended amount (PRD AIS-001), versioned as RS-PL-3 and SC-PL-2", () => {
  it("are current: RS-PL-5 keeps RS-PL-3's estimates, SC-PL-2 is the scorecard", () => {
    expect(V).toEqual({ ruleSet: "RS-PL-5", scorecard: "SC-PL-2" });
    const v3 = { ruleSet: "RS-PL-3", scorecard: "SC-PL-2" };
    expect(decide(asRsPl3(NICO_HIGH_DTI), v3).recommendedAmount).toBe(
      decide(NICO_HIGH_DTI, V).recommendedAmount,
    );
  });

  it("Maria: the grade A PD, and the amount she asked for is affordable", () => {
    const r = decide(MARIA_F1, V);
    expect([r.outcome, r.score, r.grade]).toEqual(["AUTO_APPROVE", 742, "A"]);
    expect(r.pd).toBe("0.0080");
    // (78,000 × 0.50 − 9,000) × 24 ÷ (1 + 0.012 × 24) = 559,006 → 559,000 ≥ 150,000 requested.
    expect(r.recommendedAmount).toBe("150000.00");
  });

  it("Nico: the most he can afford, rounded down to ₱1,000, below the ₱250,000 asked", () => {
    const r = decide(NICO_HIGH_DTI, V);
    expect(r.grade).toBe("C");
    expect(r.pd).toBe("0.0300");
    // (70,000 × 0.50 − 30,100) × 24 ÷ (1 + 0.016 × 24) = 4,900 × 24 ÷ 1.384 = 84,971.09 → 84,000.
    expect(r.recommendedAmount).toBe("84000.00");
  });

  it("rounds down exactly at the ₱1,000 step", () => {
    // Available 4,844.00 × 24 ÷ 1.384 = 84,000.00 exactly: kept. One centavo less: 83,000.
    const at = (obligations: string) =>
      decide(
        {
          ...NICO_HIGH_DTI,
          applicant: { ...NICO_HIGH_DTI.applicant, monthlyObligations: obligations },
        },
        V,
      ).recommendedAmount;
    expect(at("30156.00")).toBe("84000.00");
    expect(at("30156.01")).toBe("83000.00");
  });

  it("nothing affordable gives 0.00, not a negative amount", () => {
    const broke: DecisionInputs = {
      ...JOEL_F2,
      applicant: { ...JOEL_F2.applicant, monthlyObligations: "40000.00" },
    };
    expect(decide(broke, V).recommendedAmount).toBe("0.00");
  });

  it("no grade, no estimate: a knockout has neither", () => {
    const r = decide(RAMON_SANCTIONS, V);
    expect([r.outcome, r.pd, r.recommendedAmount]).toEqual(["AUTO_DECLINE", null, null]);
  });

  it("a decline-band score still carries its PD for the record", () => {
    const r = decide(CARMEN_LOW_SCORE, V);
    expect(r.outcome).toBe("AUTO_DECLINE");
    expect(r.pd).toBe("0.1200");
  });

  it("not live, the overlay keeps both estimates for the reviewer", () => {
    const r = decide({ ...MARIA_F1, automation: { mode: "SHADOW", killSwitch: false } }, V);
    expect([r.outcome, r.pd, r.recommendedAmount]).toEqual(["REFER", "0.0080", "150000.00"]);
  });

  it("earlier versions estimate nothing, so their records replay as they were", () => {
    const r = decide(asRsPl3(MARIA_F1), { ruleSet: "RS-PL-2", scorecard: "SC-PL-1" });
    expect([r.pd, r.recommendedAmount]).toEqual([null, null]);
    // The score is the same under SC-PL-1 and SC-PL-2: only the PD table was added.
    expect(r.score).toBe(decide(MARIA_F1, V).score);
  });
});

describe("D-17 records made under RS-PL-3 / SC-PL-2 keep reproducing (ADR 0022 R4)", () => {
  // Frozen when PD and the recommended amount shipped: eleven decisions, including a reused
  // bureau report, shadow mode, a knockout, nothing affordable and a circuit-open outage.
  const FIELDS = [
    "outcome",
    "engineOutcome",
    "score",
    "grade",
    "ruleResults",
    "scoreContributions",
    "reasonCodes",
    "referralTriggers",
    "debtToIncome",
    "monthlyRate",
    "pd",
    "recommendedAmount",
  ] as const;

  it.each(rsPl3Fixture.records.map((r) => [r.name, r] as const))(
    "%s replays exactly",
    (_name, stored) => {
      const inputs = stored.inputs as unknown as DecisionInputs;
      expect(hashInputs(inputs)).toBe(stored.inputsHash);
      const replay = decide(inputs, {
        ruleSet: stored.ruleSetVersion,
        scorecard: stored.scorecardVersion,
      });
      for (const field of FIELDS) {
        expect(canonicalJson(replay[field])).toBe(canonicalJson(stored[field]));
      }
    },
  );
});
