import {
  CURRENT_RULE_SET,
  CURRENT_SCORECARD,
  canonicalJson,
  type DecisionInputs,
  type DecisionResult,
  decide,
  type ExternalEngineInput,
  hashInputs,
} from "../../src/decisioning/engine";
import rsPl4Fixture from "./fixtures/rs-pl-4-records.json";
import {
  asRsPl3,
  CARMEN_LOW_SCORE,
  JOEL_F2,
  MARIA_F1,
  NICO_HIGH_DTI,
  RAFAEL_ABOVE_LIMIT,
  RAMON_SANCTIONS,
} from "./personas";

const V = { ruleSet: CURRENT_RULE_SET, scorecard: CURRENT_SCORECARD };
const codes = (r: DecisionResult) => r.reasonCodes.map((c) => c.code);
const exRule = (r: DecisionResult) => r.ruleResults.find((x) => x.id === "EX-ENGINE");

type Role = "ALONGSIDE" | "INSTEAD";
const answered = (
  role: Role,
  decision: "APPROVE" | "REFER" | "DECLINE",
  reasonCodes: string[] = [],
): ExternalEngineInput => ({ role, status: "OK", decision, reasonCodes, reference: "EXT-ABC" });
const down = (role: Role): ExternalEngineInput => ({
  role,
  status: "UNAVAILABLE",
  reason: "outage: Client decision engine is unavailable (simulated outage)",
});
const withExt = (p: DecisionInputs, external: ExternalEngineInput): DecisionInputs => ({
  ...p,
  external,
});

describe("EX-1 the external decision engine step (PRD DEC-008), versioned as RS-PL-4", () => {
  it("role NONE: every outcome, reason and estimate is RS-PL-3's, and no EX-ENGINE rule", () => {
    const v3 = { ruleSet: "RS-PL-3", scorecard: CURRENT_SCORECARD };
    for (const p of [MARIA_F1, JOEL_F2, NICO_HIGH_DTI, RAMON_SANCTIONS, CARMEN_LOW_SCORE]) {
      const now = decide(p, V);
      const before = decide(asRsPl3(p), v3);
      expect({ ...now, versions: null }).toEqual({ ...before, versions: null });
      expect(exRule(now)).toBeUndefined();
    }
  });

  describe("alongside the built-in engine", () => {
    it("agreeing, the built-in outcome stands, with the engine's answer recorded", () => {
      const r = decide(withExt(MARIA_F1, answered("ALONGSIDE", "APPROVE")), V);
      expect([r.outcome, r.engineOutcome, r.grade]).toEqual(["AUTO_APPROVE", "AUTO_APPROVE", "A"]);
      expect(exRule(r)).toMatchObject({ result: "PASS", value: "auto-approve; ref EXT-ABC" });
    });

    it("disagreeing either way, a person decides (R23 first, the built-in reasons kept)", () => {
      // Joel: built-in refers (thin file); the external engine approves.
      const joel = decide(withExt(JOEL_F2, answered("ALONGSIDE", "APPROVE")), V);
      expect(joel.outcome).toBe("REFER");
      expect(joel.engineOutcome).toBe("REFER");
      expect(codes(joel)[0]).toBe("R23");
      expect(codes(joel)).toContain("R01");
      expect(joel.referralTriggers[0]).toBe(
        "The external decision engine and the built-in engine disagree (built-in: refer; external: auto-approve)",
      );
      expect(exRule(joel)?.result).toBe("FAIL");
      // Maria: built-in approves; the external engine declines. Not a decline: a referral.
      const maria = decide(withExt(MARIA_F1, answered("ALONGSIDE", "DECLINE", ["X-9"])), V);
      expect(maria.outcome).toBe("REFER");
      expect(codes(maria)).toEqual(["R23"]);
      expect(exRule(maria)?.value).toBe("auto-decline; client codes: X-9; ref EXT-ABC");
      // Carmen: built-in declines on score; the external engine approves.
      const carmen = decide(withExt(CARMEN_LOW_SCORE, answered("ALONGSIDE", "APPROVE")), V);
      expect(carmen.outcome).toBe("REFER");
      expect(codes(carmen)).toEqual(expect.arrayContaining(["R23", "R07"]));
    });

    it("both declining on score, the decline stands", () => {
      const r = decide(withExt(CARMEN_LOW_SCORE, answered("ALONGSIDE", "DECLINE")), V);
      expect(r.outcome).toBe("AUTO_DECLINE");
    });

    it("an engine that could not answer refers, never declines (R22, NFR-005)", () => {
      const maria = decide(withExt(MARIA_F1, down("ALONGSIDE")), V);
      expect([maria.outcome, codes(maria)[0]]).toEqual(["REFER", "R22"]);
      expect(exRule(maria)?.result).toBe("NOT_EVALUATED");
      const carmen = decide(withExt(CARMEN_LOW_SCORE, down("ALONGSIDE")), V);
      expect(carmen.outcome).toBe("REFER");
    });
  });

  describe("instead of the built-in score", () => {
    it("its approval replaces the score and the credit rules (Joel's thin file, Nico's DTI)", () => {
      const joel = decide(withExt(JOEL_F2, answered("INSTEAD", "APPROVE")), V);
      expect([joel.outcome, joel.reasonCodes, joel.referralTriggers]).toEqual([
        "AUTO_APPROVE",
        [],
        [],
      ]);
      // The built-in score, grade and rate are kept: the loan is priced from the grade.
      expect([joel.score, joel.grade, joel.monthlyRate]).toEqual([
        decide(JOEL_F2, V).score,
        decide(JOEL_F2, V).grade,
        decide(JOEL_F2, V).monthlyRate,
      ]);
      expect(decide(withExt(NICO_HIGH_DTI, answered("INSTEAD", "APPROVE")), V).outcome).toBe(
        "AUTO_APPROVE",
      );
    });

    it("its decline declines (R25) and its referral refers (R24)", () => {
      const declined = decide(withExt(MARIA_F1, answered("INSTEAD", "DECLINE")), V);
      expect([declined.outcome, codes(declined), declined.referralTriggers]).toEqual([
        "AUTO_DECLINE",
        ["R25"],
        [],
      ]);
      const referred = decide(withExt(MARIA_F1, answered("INSTEAD", "REFER")), V);
      expect([referred.outcome, codes(referred)]).toEqual(["REFER", ["R24"]]);
    });

    it.each([
      ["the bureau", { bureau: { status: "UNAVAILABLE", reason: "outage" } }, ["R10", "R25"]],
      ["screening", { screening: { status: "UNAVAILABLE", reason: "outage" } }, ["R13", "R25"]],
      ["the fraud check", { fraud: { status: "UNAVAILABLE", reason: "outage" } }, ["R17", "R25"]],
    ] as const)(
      "its decline refers, never declines, when %s did not answer (NFR-005: the outage first, then R25)",
      (_what, change, expected) => {
        const r = decide(
          withExt({ ...MARIA_F1, ...change } as DecisionInputs, answered("INSTEAD", "DECLINE")),
          V,
        );
        expect(r.outcome).toBe("REFER");
        expect(r.engineOutcome).toBe("REFER");
        expect(codes(r)).toEqual(expected);
        expect(exRule(r)?.result).toBe("FAIL");
      },
    );

    it("the bank's controls still refer an external approval", () => {
      // Above the automatic approval limit (R05).
      const rafael = decide(withExt(RAFAEL_ABOVE_LIMIT, answered("INSTEAD", "APPROVE")), V);
      expect([rafael.outcome, codes(rafael)]).toEqual(["REFER", ["R05"]]);
      // Related party (R18), fraud flag (R16), fraud check down (R17), screening down (R13).
      const cases: [Partial<DecisionInputs>, string][] = [
        [{ applicant: { ...MARIA_F1.applicant, relatedParty: true } }, "R18"],
        [{ fraud: { status: "OK", flagged: true, signals: ["VELOCITY"] } }, "R16"],
        [{ fraud: { status: "UNAVAILABLE", reason: "outage" } }, "R17"],
        [{ screening: { status: "UNAVAILABLE", reason: "outage" } }, "R13"],
      ];
      for (const [change, code] of cases) {
        const r = decide(withExt({ ...MARIA_F1, ...change }, answered("INSTEAD", "APPROVE")), V);
        expect([r.outcome, codes(r)]).toEqual(["REFER", [code]]);
      }
    });

    it("an approval with no built-in grade to price it refers (R26)", () => {
      const noBureau = {
        ...MARIA_F1,
        bureau: { status: "UNAVAILABLE", reason: "outage" },
      } as const;
      const r = decide(withExt(noBureau, answered("INSTEAD", "APPROVE")), V);
      expect([r.outcome, codes(r)]).toEqual(["REFER", ["R26"]]);
    });

    it("an engine that could not answer refers (R22), with any control that fired", () => {
      const r = decide(withExt(RAFAEL_ABOVE_LIMIT, down("INSTEAD")), V);
      expect([r.outcome, codes(r)]).toEqual(["REFER", ["R22", "R05"]]);
    });
  });

  it("a knockout declines whatever the engine says, in either role", () => {
    for (const role of ["ALONGSIDE", "INSTEAD"] as const) {
      const r = decide(withExt(RAMON_SANCTIONS, answered(role, "APPROVE")), V);
      expect([r.outcome, codes(r)]).toEqual(["AUTO_DECLINE", ["R11"]]);
      expect(exRule(r)).toMatchObject({
        result: "NOT_EVALUATED",
        value: "auto-approve; ref EXT-ABC; a knockout declines whatever it says",
      });
    }
  });

  it("automation applies after it: in shadow mode the combined outcome is kept as the engine's", () => {
    const r = decide(
      {
        ...withExt(JOEL_F2, answered("INSTEAD", "APPROVE")),
        automation: { mode: "SHADOW", killSwitch: false },
      },
      V,
    );
    expect([r.outcome, r.engineOutcome, codes(r)[0]]).toEqual(["REFER", "AUTO_APPROVE", "R20"]);
  });

  it("is versioned: RS-PL-4 needs the role; earlier versions refuse it", () => {
    expect(() => decide(asRsPl3(MARIA_F1), V)).toThrow(
      /RS-PL-4 needs the external decision engine role/,
    );
    expect(() => decide(MARIA_F1, { ruleSet: "RS-PL-3", scorecard: CURRENT_SCORECARD })).toThrow(
      /RS-PL-3 does not call an external decision engine/,
    );
  });
});

describe("EX-4 records made under RS-PL-4 keep reproducing (ADR 0022 R4)", () => {
  // Frozen when the external engine step shipped: no engine, both roles, agreement and
  // disagreement, an outage, a bank control, no grade, a knockout and shadow mode.
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

  it.each(rsPl4Fixture.records.map((r) => [r.name, r] as const))(
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

  it("covers every outcome and every role", () => {
    const records = rsPl4Fixture.records;
    expect(new Set(records.map((r) => r.outcome))).toEqual(
      new Set(["AUTO_APPROVE", "REFER", "AUTO_DECLINE"]),
    );
    expect(new Set(records.map((r) => r.inputs.external.role))).toEqual(
      new Set(["NONE", "ALONGSIDE", "INSTEAD"]),
    );
  });
});
