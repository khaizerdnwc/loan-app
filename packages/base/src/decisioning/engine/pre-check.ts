import { GRADES, Money } from "@loan/core";
import { affordableAmount } from "./decide";
import { ratioAsPercent } from "./ratio";
import { ruleSet } from "./rule-sets";

/**
 * The eligibility pre-check (PRD PC-008): the policy checks that need no provider, run on
 * figures the applicant states, before any application, consent or bureau pull. Pure like the
 * decision; nothing is stored. It is indicative only: the decision still depends on the bureau,
 * screening and fraud checks and on the verified figures.
 */
export interface PreCheckInputs {
  productCode: string;
  amount: string;
  tenorMonths: number;
  ageYears: number;
  monthlyIncome: string;
  monthlyObligations: string;
}

export type PreCheckOutcome = "LIKELY_ELIGIBLE" | "REVIEW_LIKELY" | "NOT_ELIGIBLE";

export interface PreCheckResult {
  ruleSetVersion: string;
  outcome: PreCheckOutcome;
  checks: { id: string; name: string; result: "PASS" | "FAIL" | "REVIEW"; value: string }[];
  /** The add-on monthly rate across grades: the best and the worst a decision could give. */
  monthlyRateRange: { from: string; to: string };
  /**
   * The affordable amount (the rule set's debt-service limit, average instalment) at the best
   * and the worst grade's rate; null when the rule set has no affordability policy.
   */
  affordable: { atBestRate: string; atWorstRate: string } | null;
}

export function preCheck(inputs: PreCheckInputs, version: string): PreCheckResult {
  const rs = ruleSet(version);
  if (inputs.productCode !== rs.productCode) {
    throw new Error(
      `Rule set ${rs.version} is for product ${rs.productCode}, not ${inputs.productCode}`,
    );
  }
  const income = Money.of(inputs.monthlyIncome);
  const obligations = Money.of(inputs.monthlyObligations);
  const amount = Money.of(inputs.amount);
  const checks: PreCheckResult["checks"] = [];

  const ageOk = inputs.ageYears >= rs.minAge && inputs.ageYears <= rs.maxAge;
  checks.push({
    id: "PC-AGE",
    name: `Applicant age ${rs.minAge}–${rs.maxAge}`,
    result: ageOk ? "PASS" : "FAIL",
    value: `age ${inputs.ageYears}`,
  });

  // Exact, as in the decision: obligations > income × cap refers; no income always refers.
  const dtiHigh = income.isZero() || obligations.greaterThan(income.times(rs.maxDebtToIncome));
  checks.push({
    id: "PC-DTI",
    name: `Debt-to-income at or below ${ratioAsPercent(rs.maxDebtToIncome)}`,
    result: dtiHigh ? "REVIEW" : "PASS",
    value: income.isZero() ? "no income" : `DTI ${ratioAsPercent(obligations.ratioTo(income))}`,
  });

  const aboveLimit = amount.greaterThan(Money.of(rs.autoApprovalLimit));
  checks.push({
    id: "PC-AMOUNT",
    name: "Amount within the automatic approval limit",
    result: aboveLimit ? "REVIEW" : "PASS",
    value: `limit ${rs.autoApprovalLimit}`,
  });

  // The lowest and the highest rate across grades, whatever order the rule set lists them in.
  const rates = GRADES.map((g) => rs.monthlyRate[g]).sort((a, b) => rateUnits(a) - rateUnits(b));
  const best = rates[0] as string;
  const worst = rates[rates.length - 1] as string;
  let affordable: PreCheckResult["affordable"] = null;
  let nothingAffordable = false;
  if (rs.recommendedAmount) {
    const terms = {
      monthlyIncome: inputs.monthlyIncome,
      monthlyObligations: inputs.monthlyObligations,
      amount: inputs.amount,
      tenorMonths: inputs.tenorMonths,
    };
    affordable = {
      atBestRate: affordableAmount(terms, best, rs.recommendedAmount),
      atWorstRate: affordableAmount(terms, worst, rs.recommendedAmount),
    };
    nothingAffordable = Money.of(affordable.atBestRate).isZero();
    const fitsAtWorst = Money.of(affordable.atWorstRate).equals(amount);
    // Nothing affordable is a review, not a refusal: the decision would refer it (debt-to-
    // income or the score), and only a person declines it.
    checks.push({
      id: "PC-AFFORD",
      name: "Amount affordable within the debt-service limit",
      result: fitsAtWorst && !nothingAffordable ? "PASS" : "REVIEW",
      value: nothingAffordable
        ? "nothing affordable"
        : fitsAtWorst
          ? "affordable at every grade's rate"
          : `up to ${affordable.atWorstRate} at the highest rate`,
    });
  }

  const outcome: PreCheckOutcome = checks.some((c) => c.result === "FAIL")
    ? "NOT_ELIGIBLE"
    : checks.some((c) => c.result === "REVIEW")
      ? "REVIEW_LIKELY"
      : "LIKELY_ELIGIBLE";
  return {
    ruleSetVersion: rs.version,
    outcome,
    checks,
    monthlyRateRange: { from: best, to: worst },
    affordable,
  };
}

/** A monthly rate ("0.0160") as whole ten-thousandths (160), for ordering: never a float. */
function rateUnits(rate: string): number {
  if (!/^0\.\d{4}$/.test(rate)) throw new Error(`Unexpected monthly rate ${rate}`);
  return Number.parseInt(rate.slice(2), 10);
}
