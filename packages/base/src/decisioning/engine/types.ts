import type { AutomationMode, DecisionOutcome, Grade } from "@loan/core";

/**
 * Everything the decision needs, gathered once (ADR 0022 R2) and stored verbatim in the
 * decision record. Amounts are decimal strings so the snapshot is exact JSON. Nothing in
 * here is read from a clock or a database at decision time.
 */
export interface DecisionInputs {
  /** The date ages and tenures are measured at (YYYY-MM-DD). */
  asOfDate: string;
  application: {
    productCode: string;
    amount: string;
    tenorMonths: number;
  };
  applicant: {
    ageYears: number;
    /** Verified monthly income when available, else declared. */
    monthlyIncome: string;
    monthlyObligations: string;
    employmentMonths: number;
    /** Months as a WhiteBank customer; 0 for new to bank. */
    relationshipMonths: number;
    /**
     * The monthly income the applicant declared, when it was recorded apart from the verified
     * figure in `monthlyIncome`; null when there is no separate declaration. Present from
     * RS-PL-2 (absent on records made under RS-PL-1).
     */
    declaredMonthlyIncome?: string | null;
    /** A WhiteBank insider or a relative of one (PRD CMP-006). Present from RS-PL-2. */
    relatedParty?: boolean;
  };
  /**
   * Fraud signals, or `unavailable` when the check could not answer. Present from RS-PL-2
   * (absent on records made under RS-PL-1).
   */
  fraud?:
    | { status: "OK"; flagged: boolean; signals: string[] }
    | { status: "UNAVAILABLE"; reason: string };
  /**
   * The product's automation when the decision was made (PRD §7.5). Absent on records made
   * before automation modes existed: those ran live.
   */
  automation?: { mode: AutomationMode; killSwitch: boolean };
  /**
   * The external decision engine (PRD DEC-008): the product's role for it when the decision
   * was made and, unless the role is NONE, its answer or why it gave none. Present from
   * RS-PL-4 (absent on earlier records, which never called one).
   */
  external?: ExternalEngineInput;
  /** KYC/AML screening, or `unavailable` when the provider could not answer. */
  screening:
    | { status: "OK"; sanctionsMatch: boolean; kycVerified: boolean }
    | { status: "UNAVAILABLE"; reason: string };
  /** Bureau report, or `unavailable` when the provider could not answer. */
  bureau:
    | {
        status: "OK";
        /** When the bureau produced the report (ISO 8601); recorded from RS-PL-3 on. */
        retrievedAt?: string;
        /** True when a report pulled within the reuse window was used (PRD IH-005). */
        fromCache?: boolean;
        fileDepth: "FULL" | "THIN" | "NO_HIT";
        bureauScore: number | null;
        tradeLines: number;
        utilisationPct: number;
        delinquencies12m: number;
        existingDefault: boolean;
        monthsOnFile: number;
      }
    | { status: "UNAVAILABLE"; reason: string };
}

/** The external engine's part of a snapshot: its role, and its answer when it was called. */
export type ExternalEngineInput =
  | { role: "NONE" }
  | {
      role: "ALONGSIDE" | "INSTEAD";
      status: "OK";
      decision: "APPROVE" | "REFER" | "DECLINE";
      reasonCodes: string[];
      reference: string;
    }
  | { role: "ALONGSIDE" | "INSTEAD"; status: "UNAVAILABLE"; reason: string };

/** WARNING (RS-PL-5 on): recorded and shown, never changes the outcome. */
export type RuleKind = "KNOCKOUT" | "REFERRAL" | "WARNING";
export type RuleOutcome = "PASS" | "FAIL" | "NOT_EVALUATED";

export interface RuleResult {
  id: string;
  name: string;
  kind: RuleKind;
  result: RuleOutcome;
  /** What was measured, in words ("age 31", "DTI 11.5%"). */
  value: string;
}

export interface ReasonCode {
  code: string;
  /** Plain language for staff. */
  staff: string;
  /** Borrower-safe wording: no scores, no internal thresholds. */
  borrower: string;
}

export interface ScoreContribution {
  factor: string;
  detail: string;
  points: number;
}

export interface DecisionVersions {
  ruleSet: string;
  scorecard: string;
}

export interface DecisionResult {
  versions: DecisionVersions;
  /** What the case does: the engine's outcome when automation is live, otherwise REFER. */
  outcome: DecisionOutcome;
  /** What the rules and the score decided, before the automation mode applied. */
  engineOutcome: DecisionOutcome;
  /** Null when a knockout ended the pipeline, or the bureau could not be read. */
  score: number | null;
  grade: Grade | null;
  ruleResults: RuleResult[];
  scoreContributions: ScoreContribution[];
  reasonCodes: ReasonCode[];
  /** Why the case went to a person; empty unless the outcome is REFER. */
  referralTriggers: string[];
  /** Existing obligations ÷ income, 4 decimals ("0.1154"), for display and the record only;
   *  null when there is no income. Policy compares exact amounts, not this string. */
  debtToIncome: string | null;
  /** Add-on monthly rate for the grade, when there is a grade. */
  monthlyRate: string | null;
  /**
   * 12-month probability of default for the grade (decimal string, "0.0300"), from scorecards
   * that carry one (SC-PL-2 on); null otherwise or without a grade (PRD AIS-001).
   */
  pd: string | null;
  /**
   * The largest amount up to the one requested that stays affordable (rule sets with
   * `recommendedAmount`, RS-PL-3 on); null otherwise or without a grade (PRD AIS-001).
   */
  recommendedAmount: string | null;
}
