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
  /**
   * The external decision engine (PRD DEC-008) is an input, applied after the rules and the
   * score and before the automation mode: alongside, a disagreement refers; instead, its
   * outcome replaces the score and credit rules, and the bank's knockouts and mandatory
   * referrals (amount limit, related party, fraud, screening unavailable) still apply.
   */
  externalEngine?: boolean;
  /**
   * Warning rules (PRD DEC-002): recorded and shown to the reviewer and approver, never a
   * referral or a decline. Utilisation above `maxUtilisationPct`; employment under
   * `minEmploymentMonths`.
   */
  warnings?: { maxUtilisationPct: number; minEmploymentMonths: number };
  /**
   * Low model confidence refers (PRD DEC-006): an approve-band score under approveFrom +
   * `bandMargin`, a decline-band score at or above declineBelow − `bandMargin`, or fewer than
   * `minScoredFactors` of the scorecard's factors read from data (the rest fell to a default).
   * About the built-in score, so when an external engine decides "instead" it is replaced
   * with the score (not a bank control).
   */
  lowConfidence?: { bandMargin: number; minScoredFactors: number };
  /**
   * Missing data refers (DEC-006): a full bureau file with no bureau score is not scored as a
   * default and left at that. Also about the built-in score: replaced under "instead".
   */
  missingDataReferral?: boolean;
  /**
   * A policy exception refers (DEC-006): a tenor that is not a multiple of
   * `standardTenorStep` months, or an amount above `maxAmountToIncome` × monthly income. The
   * bank's terms policy, not a model judgement: a bank control that still refers an external
   * approval under "instead".
   */
  policyException?: { standardTenorStep: number; maxAmountToIncome: number };
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

/** RS-PL-2 plus a recommended amount (PRD AIS-001); every rule and trigger is unchanged. */
const RS_PL_3: RuleSet = {
  ...RS_PL_2,
  version: "RS-PL-3",
  recommendedAmount: { maxDebtServiceRatio: "0.50", roundDownTo: 1000 },
};

/**
 * RS-PL-3 plus the external decision engine step (PRD DEC-008). With the product's role NONE
 * every outcome is RS-PL-3's.
 */
const RS_PL_4: RuleSet = { ...RS_PL_3, version: "RS-PL-4", externalEngine: true };

export const RULE_SETS: Readonly<Record<string, RuleSet>> = {
  "RS-PL-1": RS_PL_1,
  "RS-PL-2": RS_PL_2,
  "RS-PL-3": RS_PL_3,
  "RS-PL-4": RS_PL_4,
  /**
   * RS-PL-4 plus warning rules (PRD DEC-002: shown, never referring) and three referral
   * triggers (DEC-006): low model confidence, missing data and policy exception. Values:
   * docs/ASSUMPTIONS.md.
   */
  "RS-PL-5": {
    ...RS_PL_4,
    version: "RS-PL-5",
    warnings: { maxUtilisationPct: 80, minEmploymentMonths: 12 },
    lowConfidence: { bandMargin: 10, minScoredFactors: 6 },
    missingDataReferral: true,
    policyException: { standardTenorStep: 6, maxAmountToIncome: 10 },
  },
};

export const CURRENT_RULE_SET = "RS-PL-5";

export function ruleSet(version: string): RuleSet {
  const rs = RULE_SETS[version];
  if (!rs) throw new Error(`Unknown rule set version ${version}`);
  return rs;
}
