/**
 * The eligibility pre-check (PRD PC-008): what the policy says about stated figures before any
 * application, consent or bureau pull. Indicative only, never a decision; nothing is stored.
 */
export interface EligibilityPreCheckRequest {
  amount: string;
  tenorMonths: number;
  ageYears: number;
  monthlyIncome: string;
  monthlyObligations: string;
}

export type EligibilityOutcome = "LIKELY_ELIGIBLE" | "REVIEW_LIKELY" | "NOT_ELIGIBLE";

export interface EligibilityPreCheckView {
  productCode: string;
  ruleSetVersion: string;
  outcome: EligibilityOutcome;
  checks: { id: string; name: string; result: "PASS" | "FAIL" | "REVIEW"; value: string }[];
  monthlyRateRange: { from: string; to: string };
  affordable: { atBestRate: string; atWorstRate: string } | null;
  /** What the pre-check cannot know: the bureau, screening and fraud checks, verified income. */
  caveat: string;
}
