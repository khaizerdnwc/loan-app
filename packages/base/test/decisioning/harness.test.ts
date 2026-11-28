import {
  adaptInputs,
  type DecisionInputs,
  type HarnessSnapshot,
  isRuleSetVersion,
  REASONS,
  ruleSet,
  runHarness,
  scorecard,
} from "../../src/decisioning/engine";
import rsPl1Fixture from "./fixtures/rs-pl-1-records.json";
import { asRsPl3, CARMEN_LOW_SCORE, MARIA_F1, NINA_NO_HIT } from "./personas";

/** HX-1: the rule-set test harness (PRD DEC-004), pure. */
type OkBureau = Extract<DecisionInputs["bureau"], { status: "OK" }>;
const snap = (caseReference: string, inputs: DecisionInputs): HarnessSnapshot => ({
  caseReference,
  inputs,
  scorecardVersion: "SC-PL-2",
});
// Maria's 742 with utilisation 80% and new to bank: 702, near the approve edge (RS-PL-5 refers).
const NEAR_APPROVE: DecisionInputs = {
  ...MARIA_F1,
  applicant: { ...MARIA_F1.applicant, relationshipMonths: 0 },
  bureau: { ...(MARIA_F1.bureau as OkBureau), utilisationPct: 80 },
};

describe("HX-1 the rule-set test harness (PRD DEC-004)", () => {
  it("RS-PL-5 against RS-PL-4: the outcome mix, the movement and each changed case", () => {
    const r = runHarness(
      [
        snap("APP-1", MARIA_F1),
        snap("APP-2", NEAR_APPROVE),
        snap("APP-3", NINA_NO_HIT),
        snap("APP-4", CARMEN_LOW_SCORE),
      ],
      "RS-PL-5",
      "RS-PL-4",
    );
    expect(r.compared).toBe(4);
    expect(r.outcomes).toEqual([
      { outcome: "AUTO_APPROVE", baseline: 2, candidate: 1 },
      { outcome: "REFER", baseline: 1, candidate: 2 },
      { outcome: "AUTO_DECLINE", baseline: 1, candidate: 1 },
    ]);
    expect(r.movement.find((m) => m.from === "AUTO_APPROVE" && m.to === "REFER")?.count).toBe(1);
    expect(r.movement.reduce((n, m) => n + m.count, 0)).toBe(4);
    // Maria and Carmen are unchanged (warnings add no reason); 702 now refers; Nina gains R27.
    expect(r.changed).toEqual([
      {
        caseReference: "APP-2",
        baselineOutcome: "AUTO_APPROVE",
        candidateOutcome: "REFER",
        // Each code with the engine's staff wording, so the screen keeps no code table.
        reasonsAdded: [{ code: "R27", staff: REASONS.lowConfidence.staff }],
        reasonsRemoved: [],
        defaults: [],
      },
      {
        caseReference: "APP-3",
        baselineOutcome: "REFER",
        candidateOutcome: "REFER",
        reasonsAdded: [{ code: "R27", staff: REASONS.lowConfidence.staff }],
        reasonsRemoved: [],
        defaults: [],
      },
    ]);
    expect(r.withDefaults).toEqual([]);
    expect(r.notComparable).toEqual([]);
  });

  it("compares the rules' own outcome, before any automation mode: a shadow snapshot is replayed live", () => {
    // A shadow-mode record against a baseline with no automation step (RS-PL-1 drops the mode).
    // Kept as recorded, the candidate's overlay would add R20 and refer; replayed live it does
    // not, so nothing changes. Deleting the "force live" line in adaptInputs fails this test.
    const shadow = { ...MARIA_F1, automation: { mode: "SHADOW", killSwitch: false } } as const;
    const r = runHarness([snap("APP-1", shadow)], "RS-PL-5", "RS-PL-1");
    expect(r.compared).toBe(1);
    expect(r.outcomes[0]).toEqual({ outcome: "AUTO_APPROVE", baseline: 1, candidate: 1 });
    expect(r.changed).toEqual([]);
    expect(JSON.stringify(r)).not.toContain("R20");
  });

  it("a snapshot the engine refuses is listed as not comparable with fixed text, not fatal", () => {
    const r = runHarness(
      [{ ...snap("APP-X", MARIA_F1), scorecardVersion: "SC-X" }, snap("APP-1", MARIA_F1)],
      "RS-PL-5",
      "RS-PL-4",
    );
    expect(r.notComparable).toEqual([
      {
        caseReference: "APP-X",
        reason: "The engine could not replay this decision under RS-PL-4.",
      },
    ]);
    expect(r.compared).toBe(1);
  });

  it("an engine error that quotes applicant figures never reaches the reason", () => {
    // A band error ("no band for -7") and a money parse error both quote the input.
    const negativeTenure = {
      ...MARIA_F1,
      applicant: { ...MARIA_F1.applicant, employmentMonths: -7 },
    };
    const unreadableIncome = {
      ...MARIA_F1,
      applicant: { ...MARIA_F1.applicant, monthlyIncome: "78k-secret" },
    };
    const r = runHarness(
      [snap("APP-A", negativeTenure), snap("APP-B", unreadableIncome)],
      "RS-PL-5",
      "RS-PL-4",
    );
    expect(r.notComparable).toEqual([
      {
        caseReference: "APP-A",
        reason: "The engine could not replay this decision under RS-PL-4.",
      },
      {
        caseReference: "APP-B",
        reason: "The engine could not replay this decision under RS-PL-4.",
      },
    ]);
    const text = JSON.stringify(r);
    for (const figure of ["-7", "78k", "secret", "band"]) expect(text).not.toContain(figure);
  });

  it("registry lookups read own keys only: 'constructor' or '__proto__' is no version", () => {
    for (const name of ["constructor", "__proto__", "toString", "hasOwnProperty"]) {
      expect(isRuleSetVersion(name)).toBe(false);
      expect(() => ruleSet(name)).toThrow(/Unknown rule set version/);
      expect(() => scorecard(name)).toThrow(/Unknown scorecard version/);
    }
    expect(isRuleSetVersion("RS-PL-5")).toBe(true);
  });

  it("a missing input gets a stated default, listed per row; a dropped one is listed too", () => {
    // An RS-PL-3 snapshot (no external engine input) replayed under RS-PL-5.
    const r = runHarness([snap("APP-1", asRsPl3(MARIA_F1))], "RS-PL-5", "RS-PL-3");
    expect(r.withDefaults).toEqual([
      expect.objectContaining({
        caseReference: "APP-1",
        defaults: ["external decision engine: not used (not recorded)"],
      }),
    ]);
    // An answer from the external engine, replayed under a version without that step.
    const ext: DecisionInputs = {
      ...MARIA_F1,
      external: {
        role: "ALONGSIDE",
        status: "OK",
        decision: "DECLINE",
        reasonCodes: [],
        reference: "EXT-1",
      },
    };
    const adapted = adaptInputs(ext, ruleSet("RS-PL-3"));
    expect(adapted).toMatchObject({
      defaults: ["external decision engine answer left out (RS-PL-3 has no such step)"],
    });
    expect("inputs" in adapted && adapted.inputs.external).toBeFalsy();
  });

  it("a snapshot that would need an invented provider answer is not comparable, never guessed", () => {
    const old = rsPl1Fixture.records[0];
    const r = runHarness(
      [snap("APP-OLD", old?.inputs as unknown as DecisionInputs), snap("APP-1", MARIA_F1)],
      "RS-PL-5",
      "RS-PL-4",
    );
    expect(r.notComparable).toEqual([
      { caseReference: "APP-OLD", reason: "RS-PL-4 needs a fraud check result" },
    ]);
    expect(r.compared).toBe(1);
    // RS-PL-1 against itself adapts it: the inputs RS-PL-2 added are dropped, nothing guessed.
    const back = adaptInputs(MARIA_F1, ruleSet("RS-PL-1"));
    expect(back).toMatchObject({ defaults: [] });
    if ("inputs" in back) {
      expect(back.inputs.fraud).toBeUndefined();
      expect(back.inputs.automation).toBeUndefined();
      expect(back.inputs.applicant.relatedParty).toBeUndefined();
    }
  });

  it("another product's snapshot is not comparable", () => {
    const other = { ...MARIA_F1, application: { ...MARIA_F1.application, productCode: "HL" } };
    expect(adaptInputs(other, ruleSet("RS-PL-5"))).toEqual({ notComparable: "product HL, not PL" });
  });
});
