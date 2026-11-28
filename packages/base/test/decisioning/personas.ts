import type { DecisionInputs } from "../../src/decisioning/engine";

/**
 * Decision inputs for the seeded personas (docs/ASSUMPTIONS.md). The seed data produces
 * exactly these snapshots, so the engine tests and the API tests agree on every outcome.
 */
const okScreening = { status: "OK", sanctionsMatch: false, kycVerified: true } as const;

/**
 * The inputs RS-PL-2 adds (no separate income declaration, not a related party, no fraud
 * signals, automation live) and the one RS-PL-4 adds (no external decision engine). The
 * personas below are current (RS-PL-4) snapshots; `asRsPl3` strips them back for the earlier
 * versions, and `fixtures/rs-pl-1-records.json` holds records made before any of these existed.
 */
export function withRsPl2Inputs(inputs: DecisionInputs): DecisionInputs {
  return {
    ...inputs,
    applicant: { declaredMonthlyIncome: null, relatedParty: false, ...inputs.applicant },
    fraud: inputs.fraud ?? { status: "OK", flagged: false, signals: [] },
    automation: inputs.automation ?? { mode: "LIVE", killSwitch: false },
    external: inputs.external ?? { role: "NONE" },
  };
}

/** A persona as an RS-PL-2 / RS-PL-3 snapshot: without the external engine input. */
export function asRsPl3(inputs: DecisionInputs): DecisionInputs {
  const { external: _external, ...rest } = inputs;
  return rest;
}

export const MARIA_F1: DecisionInputs = withRsPl2Inputs({
  asOfDate: "2026-11-28",
  application: { productCode: "PL", amount: "150000.00", tenorMonths: 24 },
  applicant: {
    ageYears: 31,
    monthlyIncome: "78000.00",
    monthlyObligations: "9000.00",
    employmentMonths: 30,
    relationshipMonths: 18,
  },
  screening: okScreening,
  bureau: {
    status: "OK",
    fileDepth: "FULL",
    bureauScore: 748,
    tradeLines: 6,
    utilisationPct: 35,
    delinquencies12m: 0,
    existingDefault: false,
    monthsOnFile: 96,
  },
});

export const JOEL_F2: DecisionInputs = withRsPl2Inputs({
  asOfDate: "2026-11-28",
  application: { productCode: "PL", amount: "200000.00", tenorMonths: 36 },
  applicant: {
    ageYears: 27,
    monthlyIncome: "56000.00",
    monthlyObligations: "11000.00",
    employmentMonths: 40,
    relationshipMonths: 0,
  },
  screening: okScreening,
  bureau: {
    status: "OK",
    fileDepth: "THIN",
    bureauScore: 640,
    tradeLines: 1,
    utilisationPct: 42,
    delinquencies12m: 0,
    existingDefault: false,
    monthsOnFile: 7,
  },
});

export const RAMON_SANCTIONS: DecisionInputs = withRsPl2Inputs({
  ...MARIA_F1,
  application: { productCode: "PL", amount: "50000.00", tenorMonths: 12 },
  applicant: { ...MARIA_F1.applicant, ageYears: 52 },
  screening: { status: "OK", sanctionsMatch: true, kycVerified: true },
});

export const NICO_HIGH_DTI: DecisionInputs = withRsPl2Inputs({
  asOfDate: "2026-11-28",
  application: { productCode: "PL", amount: "250000.00", tenorMonths: 24 },
  applicant: {
    ageYears: 35,
    monthlyIncome: "70000.00",
    monthlyObligations: "30100.00",
    employmentMonths: 60,
    relationshipMonths: 30,
  },
  screening: okScreening,
  bureau: {
    status: "OK",
    fileDepth: "FULL",
    bureauScore: 671,
    tradeLines: 5,
    utilisationPct: 45,
    delinquencies12m: 0,
    existingDefault: false,
    monthsOnFile: 80,
  },
});

export const RAFAEL_ABOVE_LIMIT: DecisionInputs = withRsPl2Inputs({
  asOfDate: "2026-11-28",
  application: { productCode: "PL", amount: "500000.00", tenorMonths: 36 },
  applicant: {
    ageYears: 44,
    monthlyIncome: "180000.00",
    monthlyObligations: "20000.00",
    employmentMonths: 120,
    relationshipMonths: 60,
  },
  screening: okScreening,
  bureau: {
    status: "OK",
    fileDepth: "FULL",
    bureauScore: 711,
    tradeLines: 9,
    utilisationPct: 25,
    delinquencies12m: 0,
    existingDefault: false,
    monthsOnFile: 150,
  },
});

export const CARMEN_LOW_SCORE: DecisionInputs = withRsPl2Inputs({
  asOfDate: "2026-11-28",
  application: { productCode: "PL", amount: "60000.00", tenorMonths: 12 },
  applicant: {
    ageYears: 29,
    monthlyIncome: "40000.00",
    monthlyObligations: "14000.00",
    employmentMonths: 8,
    relationshipMonths: 0,
  },
  screening: okScreening,
  bureau: {
    status: "OK",
    fileDepth: "FULL",
    bureauScore: 540,
    tradeLines: 4,
    utilisationPct: 85,
    delinquencies12m: 2,
    existingDefault: false,
    monthsOnFile: 40,
  },
});

/** No bureau record at all: refers for the missing history (R08), scored without a bureau score. */
export const NINA_NO_HIT: DecisionInputs = withRsPl2Inputs({
  asOfDate: "2026-11-28",
  application: { productCode: "PL", amount: "80000.00", tenorMonths: 18 },
  applicant: {
    ageYears: 23,
    monthlyIncome: "42000.00",
    monthlyObligations: "4000.00",
    employmentMonths: 14,
    relationshipMonths: 10,
  },
  screening: { status: "OK", sanctionsMatch: false, kycVerified: true },
  bureau: {
    status: "OK",
    fileDepth: "NO_HIT",
    bureauScore: null,
    tradeLines: 0,
    utilisationPct: 0,
    delinquencies12m: 0,
    existingDefault: false,
    monthsOnFile: 0,
  },
});
