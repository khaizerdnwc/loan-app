import {
  CURRENT_RULE_SET,
  CURRENT_SCORECARD,
  canonicalJson,
  type DecisionInputs,
  type DecisionResult,
  decide,
  type ExternalEngineInput,
  hashInputs,
  RULE_SETS,
  type RuleSet,
  ruleSet,
} from "../../src/decisioning/engine";
import rsPl5Fixture from "./fixtures/rs-pl-5-records.json";
import {
  CARMEN_LOW_SCORE,
  JOEL_F2,
  MARIA_F1,
  NINA_NO_HIT,
  RAFAEL_ABOVE_LIMIT,
  RAMON_SANCTIONS,
} from "./personas";

const V = { ruleSet: CURRENT_RULE_SET, scorecard: CURRENT_SCORECARD };
const V4 = { ruleSet: "RS-PL-4", scorecard: CURRENT_SCORECARD };
const RULE_SETS_FOR_TEST = RULE_SETS as Record<string, RuleSet>;
const codes = (r: DecisionResult) => r.reasonCodes.map((c) => c.code);
const rule = (r: DecisionResult, id: string) => r.ruleResults.find((x) => x.id === id);
type OkBureau = Extract<DecisionInputs["bureau"], { status: "OK" }>;
const okBureau = (p: DecisionInputs) => p.bureau as OkBureau;
const withBureau = (p: DecisionInputs, b: Partial<OkBureau>): DecisionInputs => ({
  ...p,
  bureau: { ...okBureau(p), ...b },
});
const withApplicant = (
  p: DecisionInputs,
  a: Partial<DecisionInputs["applicant"]>,
): DecisionInputs => ({ ...p, applicant: { ...p.applicant, ...a } });

it("RS-PL-5 is the current rule set", () => {
  expect(V.ruleSet).toBe("RS-PL-5");
});

describe("D-18 warning rules (PRD DEC-002): recorded and shown, never referring", () => {
  it("Carmen's 85% utilisation and 8 months' employment warn; her outcome is RS-PL-4's", () => {
    const r = decide(CARMEN_LOW_SCORE, V);
    expect(rule(r, "WN-UTILISATION")).toMatchObject({
      kind: "WARNING",
      result: "FAIL",
      value: "85%",
    });
    expect(rule(r, "WN-EMPLOYMENT")).toMatchObject({
      kind: "WARNING",
      result: "FAIL",
      value: "8 months",
    });
    const before = decide(CARMEN_LOW_SCORE, V4);
    expect([r.outcome, codes(r), r.referralTriggers]).toEqual([
      before.outcome,
      codes(before),
      before.referralTriggers,
    ]);
  });

  it("a warning alone never refers: an approval with both warnings stays an approval", () => {
    // Maria with 81% utilisation (−25), 11 months' employment (−15) and 24 months a customer
    // (+15): 717, clear of the band edge, and both warnings fail.
    const warned = decide(
      withBureau(withApplicant(MARIA_F1, { employmentMonths: 11, relationshipMonths: 24 }), {
        utilisationPct: 81,
      }),
      V,
    );
    expect(warned.score).toBe(717);
    expect(rule(warned, "WN-UTILISATION")?.result).toBe("FAIL");
    expect(rule(warned, "WN-EMPLOYMENT")?.result).toBe("FAIL");
    expect([warned.outcome, warned.reasonCodes, warned.referralTriggers]).toEqual([
      "AUTO_APPROVE",
      [],
      [],
    ]);
  });

  it("at the limits: 80% utilisation and 12 months pass; no bureau record or no bureau is not evaluated", () => {
    const at = decide(
      withBureau(withApplicant(MARIA_F1, { employmentMonths: 12 }), {
        utilisationPct: 80,
      }),
      V,
    );
    expect(rule(at, "WN-UTILISATION")?.result).toBe("PASS");
    expect(rule(at, "WN-EMPLOYMENT")?.result).toBe("PASS");
    expect(rule(decide(NINA_NO_HIT, V), "WN-UTILISATION")).toMatchObject({
      result: "NOT_EVALUATED",
      value: "no bureau record",
    });
    const down = decide({ ...MARIA_F1, bureau: { status: "UNAVAILABLE", reason: "outage" } }, V);
    expect(rule(down, "WN-UTILISATION")).toMatchObject({
      result: "NOT_EVALUATED",
      value: "bureau unavailable",
    });
    // Recorded with a knockout too.
    expect(rule(decide(RAMON_SANCTIONS, V), "WN-EMPLOYMENT")).toBeDefined();
  });
});

describe("D-19 low model confidence (PRD DEC-006) refers with R27", () => {
  // Maria's 742 with utilisation 80% (−25) and new to bank (−15): 702, in the approve band
  // but within 10 points of 700.
  const nearApprove = withBureau(withApplicant(MARIA_F1, { relationshipMonths: 0 }), {
    utilisationPct: 80,
  });
  // Bureau 560 (−110), utilisation 80% and new to bank: 592, in the decline band within 10.
  const nearDecline = withBureau(withApplicant(MARIA_F1, { relationshipMonths: 0 }), {
    bureauScore: 560,
    utilisationPct: 80,
  });

  it("an approve-band score within 10 points of 700 refers instead of approving", () => {
    const r = decide(nearApprove, V);
    expect(r.score).toBe(702);
    expect([r.outcome, codes(r)]).toEqual(["REFER", ["R27"]]);
    expect(rule(r, "RF-CONFIDENCE")).toMatchObject({
      result: "FAIL",
      value: "702 near 700; 7 of 7 factors from data",
    });
    expect(decide(nearApprove, V4).outcome).toBe("AUTO_APPROVE");
    // Bureau 700 instead of 748: 712, ten points or more above the edge, approves.
    const clear = decide(withBureau(MARIA_F1, { bureauScore: 700 }), V);
    expect([clear.score, clear.outcome]).toEqual([712, "AUTO_APPROVE"]);
  });

  it("a decline-band score within 10 points of 600 refers, the low score a reason; further below declines", () => {
    const r = decide(nearDecline, V);
    expect(r.score).toBe(592);
    expect([r.outcome, codes(r)]).toEqual(["REFER", ["R27", "R07"]]);
    expect(decide(nearDecline, V4).outcome).toBe("AUTO_DECLINE");
    // Six months' employment (−15): 577, more than 10 below: an automatic decline.
    const far = decide(withApplicant(nearDecline, { employmentMonths: 6 }), V);
    expect([far.score, far.outcome]).toEqual([577, "AUTO_DECLINE"]);
  });

  it("a refer-band score is not marked (it already goes to a person)", () => {
    const joel = decide(JOEL_F2, V);
    expect(codes(joel)).not.toContain("R27");
  });

  it("the margin's edges: 709 refers, 710 approves; 590 refers, 589 declines", () => {
    // SC-PL-2's points move Maria's 742 in steps of 5, so 709, 710, 590 and 589 cannot occur.
    // The edges are tested by placing the band edge instead: a real score 9 or 10 points
    // above approveFrom (709/710 under 700), 10 or 11 below declineBelow (590/589 under 600).
    const withEdges = (approveFrom: number, declineBelow: number) => {
      const id = `RS-TEST-${approveFrom}-${declineBelow}`;
      RULE_SETS_FOR_TEST[id] = {
        ...ruleSet(CURRENT_RULE_SET),
        version: id,
        approveFrom,
        declineBelow,
      };
      return id;
    };
    const run = (p: DecisionInputs, approveFrom: number, declineBelow: number) => {
      const id = withEdges(approveFrom, declineBelow);
      try {
        return decide(p, { ruleSet: id, scorecard: CURRENT_SCORECARD });
      } finally {
        delete RULE_SETS_FOR_TEST[id];
      }
    };
    const s712 = withBureau(MARIA_F1, { bureauScore: 700 }); // 712
    expect(decide(s712, V).score).toBe(712);
    // 712 is 9 above 703 (as 709 is above 700): refers. 10 above 702 (as 710): approves.
    expect(codes(run(s712, 703, 600))).toEqual(["R27"]);
    expect(run(s712, 702, 600).outcome).toBe("AUTO_APPROVE");
    const s592 = withBureau(withApplicant(MARIA_F1, { relationshipMonths: 0 }), {
      bureauScore: 560,
      utilisationPct: 80,
    }); // 592
    // 592 is 10 below 602 (as 590 is below 600): refers. 11 below 603 (as 589): declines.
    expect(run(s592, 700, 602).outcome).toBe("REFER");
    expect(codes(run(s592, 700, 602))).toEqual(["R27", "R07"]);
    expect(run(s592, 700, 603).outcome).toBe("AUTO_DECLINE");
    // And on the real edges, the nearest reachable scores: 707 refers, 587 declines.
    const s707 = withBureau(withApplicant(MARIA_F1, { monthlyObligations: "16000.00" }), {
      utilisationPct: 50,
    });
    expect([decide(s707, V).score, decide(s707, V).outcome]).toEqual([707, "REFER"]);
    const s587 = withBureau(withApplicant(MARIA_F1, { monthlyObligations: "16000.00" }), {
      bureauScore: 560,
      utilisationPct: 80,
    });
    expect([decide(s587, V).score, decide(s587, V).outcome]).toEqual([587, "AUTO_DECLINE"]);
  });

  it("the factor floor: 5 of 7 from data refers, 6 of 7 does not", () => {
    // A full file with no verified income: debt-to-income falls to a default (6 of 7).
    const noIncome = withApplicant(MARIA_F1, { monthlyIncome: "0.00" });
    const six = decide(noIncome, V);
    expect(rule(six, "RF-CONFIDENCE")).toMatchObject({
      result: "PASS",
      value: "6 of 7 factors from data",
    });
    expect(codes(six)).not.toContain("R27");
    // And no bureau score either (5 of 7): low confidence refers.
    const five = decide(withBureau(noIncome, { bureauScore: null }), V);
    expect(rule(five, "RF-CONFIDENCE")).toMatchObject({
      result: "FAIL",
      value: "5 of 7 factors from data",
    });
    expect(codes(five)).toContain("R27");
  });

  it("fewer than 6 of 7 factors from data refers (Nina: no score, no record, 4 of 7)", () => {
    const r = decide(NINA_NO_HIT, V);
    expect(rule(r, "RF-CONFIDENCE")).toMatchObject({
      result: "FAIL",
      value: "4 of 7 factors from data",
    });
    expect(codes(r)).toContain("R27");
  });
});

describe("D-20 missing data (PRD DEC-006) refers with R28 instead of resting on a default", () => {
  it("a full file with no bureau score refers; a thin file is not evaluated (it refers already)", () => {
    const missing = withBureau(MARIA_F1, { bureauScore: null });
    const r = decide(missing, V);
    expect(r.outcome).toBe("REFER");
    expect(codes(r)).toContain("R28");
    expect(rule(r, "RF-DATA")).toMatchObject({ result: "FAIL", value: "no bureau score" });
    expect(codes(decide(missing, V4))).not.toContain("R28");
    expect(rule(decide(JOEL_F2, V), "RF-DATA")?.result).toBe("NOT_EVALUATED");
    expect(rule(decide(MARIA_F1, V), "RF-DATA")?.result).toBe("PASS");
  });
});

describe("D-21 policy exception (PRD DEC-006) refers with R29", () => {
  it("a tenor outside 6-month steps refers; 18 and 36 months are standard", () => {
    const odd = decide(
      { ...MARIA_F1, application: { ...MARIA_F1.application, tenorMonths: 20 } },
      V,
    );
    expect([odd.outcome, codes(odd)]).toEqual(["REFER", ["R29"]]);
    expect(rule(odd, "RF-POLICY")).toMatchObject({ result: "FAIL", value: "20 months" });
    for (const tenorMonths of [18, 36]) {
      const r = decide({ ...MARIA_F1, application: { ...MARIA_F1.application, tenorMonths } }, V);
      expect(rule(r, "RF-POLICY")?.result).toBe("PASS");
    }
  });

  it("an amount above 10 × monthly income refers (exact: at 10 × passes, one centavo over refers)", () => {
    const at = (amount: string) =>
      decide(
        withApplicant(
          { ...MARIA_F1, application: { ...MARIA_F1.application, amount } },
          { monthlyIncome: "15000.00", monthlyObligations: "0.00" },
        ),
        V,
      );
    expect(rule(at("150000.00"), "RF-POLICY")?.result).toBe("PASS");
    expect(rule(at("150000.01"), "RF-POLICY")).toMatchObject({
      result: "FAIL",
      value: "amount above the income multiple",
    });
    expect(codes(at("150000.01"))).toContain("R29");
  });

  it("is a bank control: it still refers an external engine's approval under INSTEAD", () => {
    const instead: ExternalEngineInput = {
      role: "INSTEAD",
      status: "OK",
      decision: "APPROVE",
      reasonCodes: [],
      reference: "EXT-1",
    };
    const odd = decide(
      {
        ...JOEL_F2,
        application: { ...JOEL_F2.application, tenorMonths: 32 },
        external: instead,
      },
      V,
    );
    expect([odd.outcome, codes(odd)]).toEqual(["REFER", ["R29"]]);
    // An amount above 10 × monthly income is a policy exception too: it still refers.
    const large = decide(
      {
        ...withApplicant(
          { ...MARIA_F1, application: { ...MARIA_F1.application, amount: "150000.01" } },
          { monthlyIncome: "15000.00", monthlyObligations: "0.00" },
        ),
        external: instead,
      },
      V,
    );
    expect([large.outcome, codes(large)]).toEqual(["REFER", ["R29"]]);
    // Standard terms: the external approval stands.
    expect(decide({ ...JOEL_F2, external: instead }, V).outcome).toBe("AUTO_APPROVE");
    // Low confidence and missing data are about the built-in score, which INSTEAD replaces.
    const noScore = withBureau(MARIA_F1, { bureauScore: null });
    expect(decide({ ...noScore, external: instead }, V).outcome).toBe("AUTO_APPROVE");
  });

  it("the seeded personas' terms are standard", () => {
    for (const p of [MARIA_F1, JOEL_F2, RAFAEL_ABOVE_LIMIT, CARMEN_LOW_SCORE, NINA_NO_HIT]) {
      expect(rule(decide(p, V), "RF-POLICY")?.result).toBe("PASS");
    }
  });
});

it("RS-PL-4 does not apply any of it: no warnings, no new triggers", () => {
  const r = decide(CARMEN_LOW_SCORE, V4);
  expect(r.ruleResults.map((x) => x.id)).not.toEqual(expect.arrayContaining(["WN-UTILISATION"]));
  for (const id of ["WN-UTILISATION", "WN-EMPLOYMENT", "RF-CONFIDENCE", "RF-DATA", "RF-POLICY"]) {
    expect(rule(r, id)).toBeUndefined();
  }
});

describe("D-22 records made under RS-PL-5 keep reproducing (ADR 0022 R4)", () => {
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

  it.each(rsPl5Fixture.records.map((r) => [r.name, r] as const))(
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

  it("covers every outcome and each new rule failing", () => {
    const records = rsPl5Fixture.records;
    expect(new Set(records.map((r) => r.outcome))).toEqual(
      new Set(["AUTO_APPROVE", "REFER", "AUTO_DECLINE"]),
    );
    const failed = new Set(
      records.flatMap((r) => r.ruleResults.filter((x) => x.result === "FAIL").map((x) => x.id)),
    );
    for (const id of ["WN-UTILISATION", "WN-EMPLOYMENT", "RF-CONFIDENCE", "RF-DATA", "RF-POLICY"]) {
      expect(failed.has(id)).toBe(true);
    }
  });
});
