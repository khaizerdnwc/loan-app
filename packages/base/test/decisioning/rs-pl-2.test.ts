import {
  CURRENT_RULE_SET,
  CURRENT_SCORECARD,
  canonicalJson,
  type DecisionInputs,
  type DecisionResult,
  decide,
  hashInputs,
} from "../../src/decisioning/engine";
import rsPl1Fixture from "./fixtures/rs-pl-1-records.json";
import rsPl2Fixture from "./fixtures/rs-pl-2-records.json";
import { MARIA_F1, RAMON_SANCTIONS } from "./personas";

// Frozen fixtures: never regenerated (see each file's `_note`).
const storedRsPl1 = rsPl1Fixture.records;
const storedRsPl2 = rsPl2Fixture.records;

const V = { ruleSet: CURRENT_RULE_SET, scorecard: CURRENT_SCORECARD };
const codes = (r: DecisionResult) => r.reasonCodes.map((c) => c.code);
const rule = (r: DecisionResult, id: string) => r.ruleResults.find((x) => x.id === id);
const withApplicant = (applicant: Partial<DecisionInputs["applicant"]>): DecisionInputs => ({
  ...MARIA_F1,
  applicant: { ...MARIA_F1.applicant, ...applicant },
});

it("RS-PL-5 (RS-PL-4 plus warnings and three referral triggers) is current", () => {
  expect(CURRENT_RULE_SET).toBe("RS-PL-5");
});

describe("D-10 declared vs verified income (PRD DEC-006, F3)", () => {
  it("a declared income more than 15% away from the verified one refers with R15", () => {
    // Verified ₱78,000; ₱90,000 declared is 15.4% above.
    const r = decide(withApplicant({ declaredMonthlyIncome: "90000.00" }), V);
    expect(r.outcome).toBe("REFER");
    expect(r.score).toBe(742);
    expect(codes(r)).toEqual(["R15"]);
    expect(rule(r, "RF-INCOME")).toMatchObject({ result: "FAIL", value: "differs by 15.4%" });
  });

  it("exactly 15% away is within tolerance, either way (compared exactly)", () => {
    // 78,000 × 0.15 = 11,700.
    for (const declared of ["89700.00", "66300.00"]) {
      const r = decide(withApplicant({ declaredMonthlyIncome: declared }), V);
      expect(r.outcome).toBe("AUTO_APPROVE");
      expect(rule(r, "RF-INCOME")?.result).toBe("PASS");
    }
    const justOver = decide(withApplicant({ declaredMonthlyIncome: "89700.01" }), V);
    expect(justOver.outcome).toBe("REFER");
  });

  it("an income declared below the verified one by more than 15% also refers", () => {
    expect(codes(decide(withApplicant({ declaredMonthlyIncome: "60000.00" }), V))).toEqual(["R15"]);
  });

  it("no separate declaration: the rule is not evaluated and refers nothing", () => {
    const r = decide(withApplicant({ declaredMonthlyIncome: null }), V);
    expect(r.outcome).toBe("AUTO_APPROVE");
    expect(rule(r, "RF-INCOME")?.result).toBe("NOT_EVALUATED");
  });

  it("a declared income with no verified income is a mismatch", () => {
    const r = decide(
      withApplicant({ monthlyIncome: "0.00", declaredMonthlyIncome: "40000.00" }),
      V,
    );
    expect(r.outcome).toBe("REFER");
    expect(codes(r)).toContain("R15");
    expect(rule(r, "RF-INCOME")).toMatchObject({ result: "FAIL", value: "no verified income" });
  });
});

describe("D-11 fraud signals and an unanswered fraud check (PRD DEC-006, NFR-005)", () => {
  it("a fraud or identity flag refers a case that would be approved, with R16", () => {
    const r = decide(
      { ...MARIA_F1, fraud: { status: "OK", flagged: true, signals: ["DUPLICATE_IDENTITY"] } },
      V,
    );
    expect(r.outcome).toBe("REFER");
    expect(r.grade).toBe("A");
    expect(codes(r)).toEqual(["R16"]);
    expect(rule(r, "RF-FRAUD")).toMatchObject({ result: "FAIL", value: "duplicate identity" });
  });

  it("a fraud check that could not answer refers with R17, never declines", () => {
    const r = decide({ ...MARIA_F1, fraud: { status: "UNAVAILABLE", reason: "outage" } }, V);
    expect(r.outcome).toBe("REFER");
    expect(r.score).toBe(742);
    expect(codes(r)).toEqual(["R17"]);
    expect(rule(r, "RF-FRAUD")?.result).toBe("NOT_EVALUATED");
  });

  it("a fraud outage refers even a decline-band score (a trigger refers regardless of score)", () => {
    const low: DecisionInputs = {
      ...MARIA_F1,
      fraud: { status: "UNAVAILABLE", reason: "timeout" },
      bureau: {
        ...(MARIA_F1.bureau as Extract<DecisionInputs["bureau"], { status: "OK" }>),
        bureauScore: 540,
        utilisationPct: 85,
        delinquencies12m: 2,
      },
    };
    const r = decide(low, V);
    expect(r.outcome).toBe("REFER");
    expect(codes(r)).toEqual(expect.arrayContaining(["R17", "R07"]));
  });

  it("a knockout still declines first, whatever the fraud check says", () => {
    const r = decide({ ...RAMON_SANCTIONS, fraud: { status: "UNAVAILABLE", reason: "outage" } }, V);
    expect(r.outcome).toBe("AUTO_DECLINE");
    expect(codes(r)).toEqual(["R11"]);
  });
});

describe("D-12 related-party applicants always go to a person (PRD CMP-006)", () => {
  it("refers an otherwise auto-approved application with R18", () => {
    const r = decide(withApplicant({ relatedParty: true }), V);
    expect(r.outcome).toBe("REFER");
    expect(codes(r)).toEqual(["R18"]);
    expect(rule(r, "RF-RELATED")?.result).toBe("FAIL");
  });
});

describe("D-13 automation mode and kill switch (PRD §7.5, AIS-007)", () => {
  const under = (mode: "OFF" | "SHADOW" | "LIVE", killSwitch = false, base = MARIA_F1) =>
    decide({ ...base, automation: { mode, killSwitch } }, V);

  it("live: the engine's outcome stands, and the record says it ran live", () => {
    const r = under("LIVE");
    expect(r.outcome).toBe("AUTO_APPROVE");
    expect(r.engineOutcome).toBe("AUTO_APPROVE");
    expect(rule(r, "AU-MODE")).toMatchObject({ result: "PASS", value: "live" });
    expect(r.referralTriggers).toEqual([]);
  });

  it("off: the case goes to a person, with the score, grade, rate and engine outcome kept", () => {
    const r = under("OFF");
    expect(r.outcome).toBe("REFER");
    expect(r.engineOutcome).toBe("AUTO_APPROVE");
    expect([r.score, r.grade, r.monthlyRate]).toEqual([742, "A", "0.0120"]);
    expect(codes(r)).toEqual(["R19"]);
    expect(r.referralTriggers[0]).toMatch(/Automation off.*auto-approve/);
    expect(rule(r, "AU-MODE")).toMatchObject({ result: "FAIL", value: "automation off" });
  });

  it("shadow: the engine decides and records its outcome, and a person decides", () => {
    const r = under("SHADOW");
    expect(r.outcome).toBe("REFER");
    expect(r.engineOutcome).toBe("AUTO_APPROVE");
    expect(codes(r)).toEqual(["R20"]);
    expect(r.referralTriggers[0]).toMatch(/Shadow mode.*auto-approve/);
  });

  it("the kill switch sends every case to a person, whatever the mode", () => {
    for (const mode of ["LIVE", "SHADOW", "OFF"] as const) {
      const r = under(mode, true);
      expect(r.outcome).toBe("REFER");
      expect(codes(r)[0]).toBe("R21");
      expect(rule(r, "AU-MODE")?.value).toBe("kill switch on");
    }
  });

  it("not live, a knockout goes to a person too: the engine's decline and its reasons are kept", () => {
    const r = under("SHADOW", false, RAMON_SANCTIONS);
    expect(r.outcome).toBe("REFER");
    expect(r.engineOutcome).toBe("AUTO_DECLINE");
    expect(r.score).toBeNull();
    expect(codes(r)).toEqual(["R20", "R11"]);
    expect(rule(r, "KO-SANCTIONS")?.result).toBe("FAIL");
  });

  it("live, a knockout still declines", () => {
    expect(under("LIVE", false, RAMON_SANCTIONS).outcome).toBe("AUTO_DECLINE");
  });

  it("the mode is part of the hashed snapshot", () => {
    expect(hashInputs({ ...MARIA_F1, automation: { mode: "LIVE", killSwitch: false } })).not.toBe(
      hashInputs({ ...MARIA_F1, automation: { mode: "SHADOW", killSwitch: false } }),
    );
  });
});

describe("D-14 records made under RS-PL-1 still reproduce (ADR 0022 R4)", () => {
  // Captured from the engine before RS-PL-2 and automation modes existed: the inputs, hash and
  // every stored field of ten RS-PL-1 decisions (approve, refer, decline, both outages, knockouts).
  const FIELDS = [
    "outcome",
    "score",
    "grade",
    "ruleResults",
    "scoreContributions",
    "reasonCodes",
    "referralTriggers",
    "debtToIncome",
    "monthlyRate",
  ] as const;

  it.each(storedRsPl1.map((r) => [r.name, r] as const))("%s replays exactly", (_name, stored) => {
    const inputs = stored.inputs as unknown as DecisionInputs;
    expect(hashInputs(inputs)).toBe(stored.inputsHash);
    const replay = decide(inputs, {
      ruleSet: stored.ruleSetVersion,
      scorecard: stored.scorecardVersion,
    });
    for (const field of FIELDS) {
      expect(canonicalJson(replay[field])).toBe(canonicalJson(stored[field]));
    }
    // It ran before automation modes: live, so the engine's outcome is the outcome.
    expect(replay.engineOutcome).toBe(stored.outcome);
  });

  it("covers every outcome", () => {
    expect(new Set(storedRsPl1.map((r) => r.outcome))).toEqual(
      new Set(["AUTO_APPROVE", "REFER", "AUTO_DECLINE"]),
    );
  });

  it("RS-PL-2 refuses a snapshot without its inputs instead of guessing them", () => {
    const old = storedRsPl1[0]?.inputs as unknown as DecisionInputs;
    expect(() => decide(old, V)).toThrow(/RS-PL-5 needs/);
    expect(() => decide(old, { ruleSet: "RS-PL-2", scorecard: "SC-PL-1" })).toThrow(
      /RS-PL-2 needs/,
    );
  });

  it("RS-PL-2 refuses a snapshot without the automation mode; RS-PL-1 refuses one with it", () => {
    const { automation: _a, ...noMode } = MARIA_F1;
    expect(() => decide(noMode, V)).toThrow(/needs the automation mode/);
    const old = storedRsPl1[0]?.inputs as unknown as DecisionInputs;
    expect(() =>
      decide(
        { ...old, automation: { mode: "SHADOW", killSwitch: false } },
        { ruleSet: "RS-PL-1", scorecard: "SC-PL-1" },
      ),
    ).toThrow(/RS-PL-1 does not apply automation modes/);
  });
});

describe("D-15 records made under RS-PL-2 keep reproducing (ADR 0022 R4)", () => {
  // Frozen when RS-PL-2 shipped: twelve decisions across every mode, the kill switch, the new
  // triggers and a knockout. A change to the overlay or a trigger fails here; it must be a
  // new rule-set version instead.
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
  ] as const;

  it.each(storedRsPl2.map((r) => [r.name, r] as const))("%s replays exactly", (_name, stored) => {
    const inputs = stored.inputs as unknown as DecisionInputs;
    expect(hashInputs(inputs)).toBe(stored.inputsHash);
    const replay = decide(inputs, {
      ruleSet: stored.ruleSetVersion,
      scorecard: stored.scorecardVersion,
    });
    for (const field of FIELDS) {
      expect(canonicalJson(replay[field])).toBe(canonicalJson(stored[field]));
    }
  });

  it("covers every mode, the kill switch and each new trigger", () => {
    const modes = new Set(
      storedRsPl2.map((r) => {
        const a = (r.inputs as unknown as DecisionInputs).automation;
        return a?.killSwitch ? "KILL" : a?.mode;
      }),
    );
    expect(modes).toEqual(new Set(["LIVE", "SHADOW", "OFF", "KILL"]));
    const codes = new Set(storedRsPl2.flatMap((r) => r.reasonCodes.map((c) => c.code)));
    for (const code of ["R15", "R16", "R17", "R18", "R19", "R20", "R21"]) {
      expect(codes.has(code)).toBe(true);
    }
  });
});
