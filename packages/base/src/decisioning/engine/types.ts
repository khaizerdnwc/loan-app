import type { DecisionOutcome, Grade } from "@loan/core";

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
  };
  /** KYC/AML screening, or `unavailable` when the provider could not answer. */
  screening:
    | { status: "OK"; sanctionsMatch: boolean; kycVerified: boolean }
    | { status: "UNAVAILABLE"; reason: string };
  /** Bureau report, or `unavailable` when the provider could not answer. */
  bureau:
    | {
        status: "OK";
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

export type RuleKind = "KNOCKOUT" | "REFERRAL";
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
  outcome: DecisionOutcome;
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
}
