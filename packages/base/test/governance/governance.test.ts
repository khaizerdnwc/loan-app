import type { RecommendationRow } from "../../src/governance/governance.repository";
import {
  compareGrades,
  DRIFT_MINIMUM,
  summariseRecommendations,
} from "../../src/governance/governance.service";

const row = (patch: Partial<RecommendationRow>): RecommendationRow => ({
  engineOutcome: "REFER",
  automationMode: "LIVE",
  killSwitch: false,
  recommendation: "APPROVE",
  overrideReason: null,
  isOverride: false,
  ...patch,
});

describe("MG-3 override monitoring (unit, PRD AIS-011)", () => {
  it("counts overrides by reason, the engine-vs-person matrix, and not-live agreement", () => {
    const s = summariseRecommendations([
      row({ recommendation: "COUNTER_OFFER", isOverride: true, overrideReason: "OV04" }),
      row({ recommendation: "DECLINE", isOverride: true, overrideReason: "OV06" }),
      row({ recommendation: "COUNTER_OFFER", isOverride: true, overrideReason: "OV04" }),
      // Shadow: the engine approved and the person approved; the engine approved, the person declined.
      row({ engineOutcome: "AUTO_APPROVE", automationMode: "SHADOW" }),
      row({
        engineOutcome: "AUTO_APPROVE",
        automationMode: "SHADOW",
        recommendation: "DECLINE",
        isOverride: true,
        overrideReason: "OV06",
      }),
      // Kill switch on a live product, engine declined, person declined: agreement.
      row({ engineOutcome: "AUTO_DECLINE", killSwitch: true, recommendation: "DECLINE" }),
      // Off, but the engine referred: not compared.
      row({ engineOutcome: "REFER", automationMode: "OFF" }),
    ]);
    expect(s.recommendations).toBe(7);
    expect(s.overrides).toBe(4);
    expect(s.byReason).toEqual([
      { code: "OV04", count: 2 },
      { code: "OV06", count: 2 },
    ]);
    expect(s.matrix).toContainEqual({
      engineOutcome: "REFER",
      recommendation: "COUNTER_OFFER",
      count: 2,
    });
    expect(s.matrix).toContainEqual({
      engineOutcome: "AUTO_APPROVE",
      recommendation: "DECLINE",
      count: 1,
    });
    expect(s.notLive).toEqual({ compared: 3, agreed: 2 });
  });

  it("nothing in the window gives zeros", () => {
    expect(summariseRecommendations([])).toEqual({
      recommendations: 0,
      overrides: 0,
      byReason: [],
      matrix: [],
      notLive: { compared: 0, agreed: 0 },
    });
  });
});

describe("MG-4 drift (unit, PRD AIS-009)", () => {
  const counts = (a: number, b: number, c: number, d: number, e: number) =>
    [
      { grade: "A", n: a, scoreSum: a * 760 },
      { grade: "B", n: b, scoreSum: b * 720 },
      { grade: "C", n: c, scoreSum: c * 650 },
      { grade: "D", n: d, scoreSum: d * 580 },
      { grade: "E", n: e, scoreSum: e * 500 },
    ].filter((x) => x.n > 0);

  it("the same distribution is stable (PSI 0)", () => {
    const r = compareGrades(counts(20, 20, 20, 20, 20), counts(10, 10, 10, 10, 10));
    expect(r.psi).toBe("0.0000");
    expect(r.status).toBe("STABLE");
    expect(r.grades[0]).toEqual({ grade: "A", baselinePct: 20, recentPct: 20 });
  });

  it("a shift towards the low grades is significant", () => {
    const r = compareGrades(counts(40, 30, 20, 10, 0), counts(0, 10, 20, 30, 40));
    expect(Number(r.psi)).toBeGreaterThan(0.25);
    expect(r.status).toBe("SIGNIFICANT");
  });

  it("a smaller shift is moderate (0.10 to 0.25)", () => {
    // A 35→20%, C 20→25%, D 10→15%, E 5→10%: PSI ≈ 0.084 + 0.011 + 0.020 + 0.035 = 0.150.
    const r = compareGrades(counts(35, 30, 20, 10, 5), counts(20, 30, 25, 15, 10));
    expect(r.psi).toBe("0.1500");
    expect(r.status).toBe("MODERATE");
  });

  it(`gives no status with fewer than ${DRIFT_MINIMUM} scored decisions in a window`, () => {
    const r = compareGrades(counts(20, 20, 20, 20, 20), counts(5, 5, 5, 5, 5));
    expect(r.status).toBe("INSUFFICIENT_DATA");
    // No figure on too little data: it would read as a measurement.
    expect(r.psi).toBeNull();
    expect(compareGrades([], []).psi).toBeNull();
  });

  it("the boundary: 29 in either window gives no status; 30 in both gives one", () => {
    const thirty = counts(6, 6, 6, 6, 6);
    const twentyNine = counts(6, 6, 6, 6, 5);
    expect(compareGrades(twentyNine, thirty)).toMatchObject({
      status: "INSUFFICIENT_DATA",
      psi: null,
    });
    expect(compareGrades(thirty, twentyNine)).toMatchObject({
      status: "INSUFFICIENT_DATA",
      psi: null,
    });
    const both = compareGrades(thirty, thirty);
    expect(both).toMatchObject({ status: "STABLE", psi: "0.0000" });
  });
});
