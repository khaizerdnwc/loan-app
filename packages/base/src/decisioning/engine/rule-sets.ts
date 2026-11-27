import type { Grade } from "@loan/core";

/**
 * Versioned policy (ADR 0022 R4). A change is a new version; old versions stay, so a
 * decision recorded under one can always be replayed. Values: docs/ASSUMPTIONS.md.
 */
export interface RuleSet {
  version: string;
  productCode: string;
  minAge: number;
  maxAge: number;
  /** Debt-to-income above this is a referral trigger (ratio, decimal string). */
  maxDebtToIncome: string;
  /** Amounts above this are a referral trigger (whole pesos). */
  autoApprovalLimit: string;
  /** Score at or above: approve band. */
  approveFrom: number;
  /** Score below: decline band. Between the two: refer. */
  declineBelow: number;
  /**
   * A decline-band score with a referral trigger: REFER (PRD: a trigger sends the case to
   * a person "regardless of score") or DECLINE. Part of the rule set so that changing it
   * is a new version, and stored decisions still replay as they were made.
   */
  lowScoreWithTrigger: "REFER" | "DECLINE";
  /** Add-on monthly rate per grade (decimal strings). */
  monthlyRate: Record<Grade, string>;
}

export const RULE_SETS: Readonly<Record<string, RuleSet>> = {
  "RS-PL-1": {
    version: "RS-PL-1",
    productCode: "PL",
    minAge: 21,
    maxAge: 65,
    maxDebtToIncome: "0.40",
    autoApprovalLimit: "300000.00",
    approveFrom: 700,
    declineBelow: 600,
    lowScoreWithTrigger: "REFER",
    monthlyRate: { A: "0.0120", B: "0.0140", C: "0.0160", D: "0.0180", E: "0.0200" },
  },
};

export const CURRENT_RULE_SET = "RS-PL-1";

export function ruleSet(version: string): RuleSet {
  const rs = RULE_SETS[version];
  if (!rs) throw new Error(`Unknown rule set version ${version}`);
  return rs;
}
