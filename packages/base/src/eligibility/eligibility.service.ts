import {
  type EligibilityPreCheckRequest,
  type EligibilityPreCheckView,
  FeatureFlag,
  type FieldError,
  type Money,
} from "@loan/core";
import { Injectable } from "@nestjs/common";
import { validation } from "../cases/domain-error";
import { PERSONAL_LOAN, parseRequestAmount, termErrors } from "../cases/product";
import { CURRENT_RULE_SET, preCheck } from "../decisioning/engine";
import { FeaturesService } from "../features/features.service";

export const PRE_CHECK_CAVEAT =
  "Indicative only, from the figures given: not a decision or an offer. The decision also depends on the credit bureau, KYC/AML screening and the fraud check (run only after consent) and on verified income.";

/**
 * The eligibility pre-check (PRD PC-008). It reads no provider and no database and writes
 * nothing: the engine's pure pre-check over stated figures, against the current rule set and
 * the product's limits. Nothing personal is sent, so it needs no consent. It is a module the
 * bank can switch off (feature flag ELIGIBILITY_PRECHECK, PRD PLT-006).
 */
@Injectable()
export class EligibilityService {
  constructor(private readonly features: FeaturesService) {}

  async preCheck(body: EligibilityPreCheckRequest): Promise<EligibilityPreCheckView> {
    await this.features.assertEnabled(FeatureFlag.EligibilityPrecheck);
    const amount = parseRequestAmount(body.amount);
    const errors: FieldError[] = termErrors(amount, body.tenorMonths);
    const income = money(body.monthlyIncome, "monthlyIncome", errors);
    const obligations = money(body.monthlyObligations, "monthlyObligations", errors);
    if (errors.length || !amount || !income || !obligations) {
      throw validation("Check the highlighted fields.", errors);
    }
    const r = preCheck(
      {
        productCode: PERSONAL_LOAN.code,
        amount: amount.toString(),
        tenorMonths: body.tenorMonths,
        ageYears: body.ageYears,
        monthlyIncome: income.toString(),
        monthlyObligations: obligations.toString(),
      },
      CURRENT_RULE_SET,
    );
    return { productCode: PERSONAL_LOAN.code, ...r, caveat: PRE_CHECK_CAVEAT };
  }
}

/** A stated monthly figure as Money; a field error when it cannot be read or is negative. */
function money(raw: string, field: string, errors: FieldError[]): Money | null {
  const m = parseRequestAmount(raw);
  if (!m || m.isNegative()) {
    errors.push({ field, message: "Enter an amount in pesos, zero or more." });
    return null;
  }
  return m;
}
