import {
  CURRENT_RULE_SET,
  type DecisionInputs,
  decide,
  PROHIBITED_FEATURES,
  prohibitedFeaturesIn,
  SCORECARDS,
  type Scorecard,
  type ScoringFeature,
} from "../../src/decisioning/engine";
import { MARIA_F1 } from "./personas";

/** The registry is read-only in production code; a test may register a variant briefly. */
const SCORECARDS_FOR_TEST = SCORECARDS as Record<string, Scorecard>;

/** Each score contribution's factor, as the feature it is computed from. */
const FACTOR_FEATURE: Record<string, ScoringFeature> = {
  "Bureau score": "bureau.bureauScore",
  "Credit file": "bureau.fileDepth",
  "Debt-to-income": "applicant.debtToIncome",
  "Credit utilisation": "bureau.utilisationPct",
  "Missed payments (12 months)": "bureau.delinquencies12m",
  Employment: "applicant.employmentMonths",
  "WhiteBank relationship": "applicant.relationshipMonths",
};

describe("MG-1 the declared features are what the score actually reads", () => {
  it.each(Object.keys(SCORECARDS))(
    "%s: every contribution comes from a declared feature, and every declared feature contributes",
    (version) => {
      const sc = SCORECARDS[version] as Scorecard;
      const r = decide(MARIA_F1, { ruleSet: CURRENT_RULE_SET, scorecard: version });
      const read = r.scoreContributions
        .map((c) => c.factor)
        .filter((f) => f !== "Base points")
        .map((f) => FACTOR_FEATURE[f]);
      expect(read).not.toContain(undefined);
      expect([...read].sort()).toEqual([...sc.features].sort());
    },
  );

  it("an attribute that is not a declared feature never moves the score, grade or PD", () => {
    const at = (inputs: DecisionInputs) => {
      const r = decide(inputs, { ruleSet: CURRENT_RULE_SET, scorecard: "SC-PL-2" });
      return [r.score, r.grade, r.pd, r.scoreContributions];
    };
    const base = at(MARIA_F1);
    // Age (prohibited as a score factor; still a knockout outside 21–65), and attributes the
    // score does not read: related party (a referral trigger), declared income.
    for (const changed of [
      { ...MARIA_F1, applicant: { ...MARIA_F1.applicant, ageYears: 64 } },
      { ...MARIA_F1, applicant: { ...MARIA_F1.applicant, ageYears: 21 } },
      { ...MARIA_F1, applicant: { ...MARIA_F1.applicant, relatedParty: true } },
      { ...MARIA_F1, applicant: { ...MARIA_F1.applicant, declaredMonthlyIncome: "90000.00" } },
    ] as DecisionInputs[]) {
      expect(at(changed)).toEqual(base);
    }
  });
});

describe("MG-1 prohibited features are checked at scoring (PRD AIS-012, CMP-007)", () => {
  it("no registered scorecard reads a prohibited attribute", () => {
    for (const sc of Object.values(SCORECARDS)) {
      expect([sc.version, prohibitedFeaturesIn(sc)]).toEqual([sc.version, []]);
      expect(sc.features.length).toBeGreaterThan(0);
    }
  });

  it("age is on the list: it is a policy knockout, never a score factor", () => {
    expect(PROHIBITED_FEATURES).toContain("applicant.ageYears");
    expect(PROHIBITED_FEATURES).toContain("applicant.gender");
  });

  it("a scorecard that lists one is refused when it scores anyone", () => {
    const base = SCORECARDS["SC-PL-2"] as Scorecard;
    SCORECARDS_FOR_TEST["SC-TEST-BAD"] = {
      ...base,
      version: "SC-TEST-BAD",
      features: [...base.features, "applicant.gender"],
    };
    try {
      expect(prohibitedFeaturesIn(SCORECARDS_FOR_TEST["SC-TEST-BAD"] as Scorecard)).toEqual([
        "applicant.gender",
      ]);
      expect(() =>
        decide(MARIA_F1, { ruleSet: CURRENT_RULE_SET, scorecard: "SC-TEST-BAD" }),
      ).toThrow(/SC-TEST-BAD uses prohibited features: applicant.gender/);
    } finally {
      delete SCORECARDS_FOR_TEST["SC-TEST-BAD"];
    }
  });
});
