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
  /**
   * Declared against verified income (PRD DEC-006, F3): a difference above this share of the
   * verified income is a referral trigger (ratio, decimal string). Absent: no such rule.
   */
  incomeMismatchTolerance?: string;
  /** A fraud or identity flag, or a fraud check that could not answer, refers (DEC-006). */
  fraudCheck?: boolean;
  /** A related-party (insider) applicant always goes to a person (CMP-006). */
  relatedPartyReferral?: boolean;
  /**
   * The product's automation mode and kill switch are an input, applied last (PRD §7.5):
   * not live, the case is referred and the engine's own outcome kept. A change to that step
   * is a new rule-set version, like any rule.
   */
  automationModes?: boolean;
  /**
   * The recommended (affordable) amount (PRD AIS-001): existing obligations plus the new
   * loan's average monthly instalment (principal + add-on interest, ÷ tenor) within
   * `maxDebtServiceRatio` of income, rounded down to `roundDownTo` pesos. The schedule's last
   * instalment absorbs rounding (ADR 0019) and may exceed the average by a few centavos.
   */
  recommendedAmount?: { maxDebtServiceRatio: string; roundDownTo: number };
}

const RS_PL_1: RuleSet = {
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
};

/** RS-PL-1 plus the income-mismatch, fraud and related-party referral triggers. */
const RS_PL_2: RuleSet = {
  ...RS_PL_1,
  version: "RS-PL-2",
  incomeMismatchTolerance: "0.15",
  fraudCheck: true,
  relatedPartyReferral: true,
  automationModes: true,
};

export const RULE_SETS: Readonly<Record<string, RuleSet>> = {
  "RS-PL-1": RS_PL_1,
  "RS-PL-2": RS_PL_2,
  /** RS-PL-2 plus a recommended amount (PRD AIS-001); every rule and trigger is unchanged. */
  "RS-PL-3": {
    ...RS_PL_2,
    version: "RS-PL-3",
    recommendedAmount: { maxDebtServiceRatio: "0.50", roundDownTo: 1000 },
  },
};

export const CURRENT_RULE_SET = "RS-PL-3";

export function ruleSet(version: string): RuleSet {
  const rs = RULE_SETS[version];
  if (!rs) throw new Error(`Unknown rule set version ${version}`);
  return rs;
}
