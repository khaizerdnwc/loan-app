import type { Grade, Money } from "@loan/core";
import type { DecisionInputs, ScoreContribution } from "./types";

/**
 * Versioned additive scorecards over simulated bureau data (the PRD's cold-start
 * "expert scorecard", LND-AIS-004). Points per factor are summed onto a base and clamped.
 * The base was chosen so the PRD's worked examples land where the PRD says: Maria Santos
 * 742 (grade A) and Joel Reyes 612 (grade C). This is a demonstration scorecard, not a
 * validated model (docs/ASSUMPTIONS.md).
 */
type Bureau = Extract<DecisionInputs["bureau"], { status: "OK" }>;

interface Band {
  /** Inclusive lower bound of the measured value. */
  from: number;
  points: number;
  label: string;
}

export interface Scorecard {
  version: string;
  basePoints: number;
  min: number;
  max: number;
  /** Grade cut-offs, highest first: score >= from gets the grade. */
  grades: { grade: Grade; from: number }[];
  bureauScore: Band[];
  noBureauScorePoints: number;
  fileDepth: Record<Bureau["fileDepth"], number>;
  /** DTI bands by upper bound (exclusive ratio), lowest first; the last band is open-ended. */
  debtToIncome: { below: string | null; points: number; label: string }[];
  utilisation: { below: number | null; points: number }[];
  delinquencies: { atMost: number | null; points: number }[];
  employmentMonths: Band[];
  relationship: { newToBank: number; under24Months: number; from24Months: number };
  /**
   * 12-month probability of default per grade (decimal strings). Absent on SC-PL-1, whose
   * records carry no PD; a change to it is a new scorecard version.
   */
  pdByGrade?: Record<Grade, string>;
  /**
   * The applicant and bureau attributes the points read (PRD AIS-012): checked against
   * PROHIBITED_FEATURES on every decision, and listed in the model registry.
   */
  features: readonly ScoringFeature[];
}

/** An attribute a scorecard may read, named as in the decision inputs. */
export type ScoringFeature =
  | "bureau.bureauScore"
  | "bureau.fileDepth"
  | "bureau.utilisationPct"
  | "bureau.delinquencies12m"
  | "applicant.debtToIncome"
  | "applicant.employmentMonths"
  | "applicant.relationshipMonths"
  | ProhibitedFeature;

/**
 * Attributes no score may use (PRD AIS-012, CMP-007 fair lending): protected characteristics
 * and close proxies. Age is a policy knockout (21–65), never a score factor. A scorecard that
 * lists one of these is refused when it scores (decide), and fails its unit test.
 */
export const PROHIBITED_FEATURES = [
  "applicant.sex",
  "applicant.gender",
  "applicant.civilStatus",
  "applicant.religion",
  "applicant.ethnicity",
  "applicant.disability",
  "applicant.politicalAffiliation",
  "applicant.ageYears",
  "applicant.birthPlace",
] as const;
export type ProhibitedFeature = (typeof PROHIBITED_FEATURES)[number];

/** The prohibited attributes a scorecard reads; empty when it is clean. */
export function prohibitedFeaturesIn(sc: Pick<Scorecard, "features">): ProhibitedFeature[] {
  return sc.features.filter((f): f is ProhibitedFeature =>
    (PROHIBITED_FEATURES as readonly string[]).includes(f),
  );
}

const SC_PL_1: Scorecard = {
  version: "SC-PL-1",
  features: [
    "bureau.bureauScore",
    "bureau.fileDepth",
    "applicant.debtToIncome",
    "bureau.utilisationPct",
    "bureau.delinquencies12m",
    "applicant.employmentMonths",
    "applicant.relationshipMonths",
  ],
  basePoints: 307,
  min: 450,
  max: 820,
  grades: [
    { grade: "A", from: 740 },
    { grade: "B", from: 700 },
    { grade: "C", from: 600 },
    { grade: "D", from: 560 },
    { grade: "E", from: 0 },
  ],
  bureauScore: [
    { from: 740, points: 200, label: "740 and above" },
    { from: 680, points: 170, label: "680–739" },
    { from: 620, points: 130, label: "620–679" },
    { from: 560, points: 90, label: "560–619" },
    { from: 0, points: 40, label: "below 560" },
  ],
  noBureauScorePoints: 60,
  fileDepth: { FULL: 60, THIN: 0, NO_HIT: -20 },
  debtToIncome: [
    { below: "0.20", points: 80, label: "under 20%" },
    { below: "0.30", points: 60, label: "20–30%" },
    { below: "0.40", points: 30, label: "30–40%" },
    { below: null, points: -20, label: "40% and above" },
  ],
  utilisation: [
    { below: 30, points: 40 },
    { below: 50, points: 25 },
    { below: 75, points: 10 },
    { below: null, points: 0 },
  ],
  delinquencies: [
    { atMost: 0, points: 30 },
    { atMost: 1, points: 0 },
    { atMost: null, points: -60 },
  ],
  employmentMonths: [
    { from: 36, points: 40, label: "3 years or more" },
    { from: 12, points: 25, label: "1–3 years" },
    { from: 6, points: 10, label: "6–12 months" },
    { from: 0, points: 0, label: "under 6 months" },
  ],
  relationship: { newToBank: 0, under24Months: 15, from24Months: 30 },
};

export const SCORECARDS: Readonly<Record<string, Scorecard>> = {
  "SC-PL-1": SC_PL_1,
  /**
   * SC-PL-1's points, unchanged, plus a 12-month PD per grade. Demonstration values, not a
   * calibrated model (docs/ASSUMPTIONS.md).
   */
  "SC-PL-2": {
    ...SC_PL_1,
    version: "SC-PL-2",
    pdByGrade: { A: "0.0080", B: "0.0150", C: "0.0300", D: "0.0600", E: "0.1200" },
  },
};

export const CURRENT_SCORECARD = "SC-PL-2";

export function scorecard(version: string): Scorecard {
  const sc = SCORECARDS[version];
  if (!sc) throw new Error(`Unknown scorecard version ${version}`);
  return sc;
}

function band(bands: Band[], value: number): Band {
  const hit = bands.find((b) => value >= b.from);
  if (!hit) throw new Error(`no band for ${value}`);
  return hit;
}

/**
 * Score one applicant. DTI bands are compared exactly (obligations < income × bound); zero
 * income falls in the open-ended last band.
 */
export function score(
  sc: Scorecard,
  bureau: Bureau,
  applicant: DecisionInputs["applicant"],
  debt: { obligations: Money; income: Money },
): { score: number; grade: Grade; contributions: ScoreContribution[] } {
  const contributions: ScoreContribution[] = [
    { factor: "Base points", detail: sc.version, points: sc.basePoints },
  ];

  if (bureau.bureauScore === null) {
    contributions.push({
      factor: "Bureau score",
      detail: "no score",
      points: sc.noBureauScorePoints,
    });
  } else {
    const b = band(sc.bureauScore, bureau.bureauScore);
    contributions.push({
      factor: "Bureau score",
      detail: `${bureau.bureauScore} (${b.label})`,
      points: b.points,
    });
  }

  contributions.push({
    factor: "Credit file",
    detail: bureau.fileDepth.toLowerCase().replace("_", " "),
    points: sc.fileDepth[bureau.fileDepth],
  });

  const dtiBand = sc.debtToIncome.find(
    (d) =>
      d.below === null ||
      (!debt.income.isZero() && debt.obligations.lessThan(debt.income.times(d.below))),
  );
  if (!dtiBand) throw new Error("no DTI band matched");
  contributions.push({ factor: "Debt-to-income", detail: dtiBand.label, points: dtiBand.points });

  const util = sc.utilisation.find((u) => u.below === null || bureau.utilisationPct < u.below);
  if (!util) throw new Error(`no utilisation band for ${bureau.utilisationPct}`);
  contributions.push({
    factor: "Credit utilisation",
    detail: `${bureau.utilisationPct}%`,
    points: util.points,
  });

  const delinq = sc.delinquencies.find(
    (d) => d.atMost === null || bureau.delinquencies12m <= d.atMost,
  );
  if (!delinq) throw new Error(`no delinquency band for ${bureau.delinquencies12m}`);
  contributions.push({
    factor: "Missed payments (12 months)",
    detail: String(bureau.delinquencies12m),
    points: delinq.points,
  });

  const emp = band(sc.employmentMonths, applicant.employmentMonths);
  contributions.push({ factor: "Employment", detail: emp.label, points: emp.points });

  const rel =
    applicant.relationshipMonths === 0
      ? { detail: "new to bank", points: sc.relationship.newToBank }
      : applicant.relationshipMonths < 24
        ? {
            detail: `${applicant.relationshipMonths} months`,
            points: sc.relationship.under24Months,
          }
        : {
            detail: `${applicant.relationshipMonths} months`,
            points: sc.relationship.from24Months,
          };
  contributions.push({ factor: "WhiteBank relationship", ...rel });

  const raw = contributions.reduce((sum, c) => sum + c.points, 0);
  const clamped = Math.min(sc.max, Math.max(sc.min, raw));
  const grade = gradeFor(clamped, sc);
  return { score: clamped, grade, contributions };
}

/** The grade for a score: the first cut-off (highest first) the score reaches. */
export function gradeFor(scoreValue: number, sc: Scorecard): Grade {
  const grade = sc.grades.find((g) => scoreValue >= g.from)?.grade;
  if (!grade) throw new Error(`no grade for ${scoreValue}`);
  return grade;
}
