import { createHash } from "node:crypto";
import { AutomationMode, DecisionOutcome, type Grade, Money } from "@loan/core";
import { ratioAsPercent } from "./ratio";
import { REASONS } from "./reason-codes";
import { type RuleSet, ruleSet } from "./rule-sets";
import { type Scorecard, score, scorecard } from "./scorecards";
import type {
  DecisionInputs,
  DecisionResult,
  DecisionVersions,
  ReasonCode,
  RuleResult,
} from "./types";

/**
 * The automated credit decision (ADR 0022): a pure function of the input snapshot and the
 * versions. No clock, no database, no randomness — the same inputs and versions always
 * give the same result, which is what makes a stored decision reproducible.
 *
 * Order (PRD 7.1): knockouts first (they end the pipeline and cannot be overridden by the
 * score), then the score and its band, then referral triggers that send a case to a person
 * whatever the score. A provider that could not answer degrades to a referral, never to a
 * decline (PRD NFR-005). Last, the product's automation mode (PRD §7.5), an input like the
 * rest: unless automation is live and the kill switch is off, the case goes to a person and
 * the engine's own outcome is kept beside it (`engineOutcome`).
 */
export function decide(inputs: DecisionInputs, versions: DecisionVersions): DecisionResult {
  const byRules = decideByRules(inputs, versions);
  const rs = ruleSet(versions.ruleSet);
  // The overlay is versioned like any rule (ADR 0022 R4): a rule set with `automationModes`
  // needs the mode in the snapshot, and one without it refuses a snapshot that carries one.
  if (rs.automationModes && !inputs.automation) {
    throw new Error(`Rule set ${rs.version} needs the automation mode in the decision inputs`);
  }
  if (!rs.automationModes && inputs.automation) {
    throw new Error(`Rule set ${rs.version} does not apply automation modes`);
  }
  const sc = scorecard(versions.scorecard);
  const withEstimates: DecisionResult = {
    ...byRules,
    engineOutcome: byRules.outcome,
    ...estimates(byRules.grade, inputs, rs, sc),
  };
  return applyAutomation(withEstimates, inputs.automation);
}

type RulesResult = Omit<DecisionResult, "engineOutcome" | "pd" | "recommendedAmount">;

/**
 * The probability of default and the recommended amount (PRD AIS-001), each switched on by its
 * own version: PD by the scorecard (`pdByGrade`, SC-PL-2 on), the amount by the rule set
 * (`recommendedAmount`, RS-PL-3 on). Earlier versions give null for both, so their records
 * replay unchanged. Nothing is estimated without a grade (knockout, bureau outage).
 */
function estimates(
  grade: Grade | null,
  inputs: DecisionInputs,
  rs: RuleSet,
  sc: Scorecard,
): { pd: string | null; recommendedAmount: string | null } {
  if (!grade) return { pd: null, recommendedAmount: null };
  return {
    pd: sc.pdByGrade?.[grade] ?? null,
    recommendedAmount: rs.recommendedAmount
      ? recommendedAmount(inputs, rs.monthlyRate[grade], rs.recommendedAmount)
      : null,
  };
}

/**
 * The largest amount, at most the one requested, whose average add-on instalment keeps the
 * monthly debt service within `maxDebtServiceRatio` of income: obligations + amount × (1/n + r)
 * ≤ income × ratio, so amount ≤ (income × ratio − obligations) × n ÷ (1 + r·n). The policy is
 * on the average instalment: the schedule's last one absorbs rounding (ADR 0019) and can be a
 * few centavos higher. Exact decimal arithmetic, rounded down to `roundDownTo` pesos; "0.00"
 * when nothing is affordable.
 */
function recommendedAmount(
  inputs: DecisionInputs,
  monthlyRate: string,
  policy: NonNullable<RuleSet["recommendedAmount"]>,
): string {
  const { applicant, application } = inputs;
  const n = application.tenorMonths;
  const available = Money.of(applicant.monthlyIncome)
    .times(policy.maxDebtServiceRatio)
    .minus(Money.of(applicant.monthlyObligations));
  if (available.isNegative() || available.isZero()) return "0.00";
  // 1 + r·n as an integer over 10,000: the rate has exactly four decimals ("0.0160" → 160).
  if (!/^0\.\d{4}$/.test(monthlyRate)) throw new Error(`Unexpected monthly rate ${monthlyRate}`);
  const rateBp = Number.parseInt(monthlyRate.slice(2), 10);
  const affordable = available.times(n * 10_000).dividedBy(10_000 + rateBp * n);
  // Round down to a multiple of `roundDownTo`: divide so the step is one centavo, round down.
  const step = policy.roundDownTo * 100;
  const floored = affordable.dividedBy(step).round("DOWN").times(step);
  const requested = Money.of(application.amount);
  return (floored.lessThan(requested) ? floored : requested).toString();
}

function decideByRules(inputs: DecisionInputs, versions: DecisionVersions): RulesResult {
  const rs = ruleSet(versions.ruleSet);
  const sc = scorecard(versions.scorecard);
  const { applicant, application, bureau, screening } = inputs;
  if (application.productCode !== rs.productCode) {
    throw new Error(
      `Rule set ${rs.version} is for product ${rs.productCode}, not ${application.productCode}`,
    );
  }

  // Policy comparisons use exact Money arithmetic (obligations > income × cap). The 4-decimal
  // ratio is only for display and the record. Zero income has no ratio and always refers.
  const income = Money.of(applicant.monthlyIncome);
  const obligations = Money.of(applicant.monthlyObligations);
  const dti = income.isZero() ? null : obligations.ratioTo(income);
  const dtiLabel = dti === null ? "no income" : `DTI ${ratioAsPercent(dti)}`;

  const rules: RuleResult[] = [];
  const reasons: ReasonCode[] = [];
  const knockouts: ReasonCode[] = [];
  const triggers: string[] = [];
  const add = (reason: ReasonCode) => {
    if (!reasons.some((r) => r.code === reason.code)) reasons.push(reason);
  };

  // --- Knockouts --------------------------------------------------------------------
  const ageOk = applicant.ageYears >= rs.minAge && applicant.ageYears <= rs.maxAge;
  rules.push({
    id: "KO-AGE",
    name: `Applicant age ${rs.minAge}–${rs.maxAge}`,
    kind: "KNOCKOUT",
    result: ageOk ? "PASS" : "FAIL",
    value: `age ${applicant.ageYears}`,
  });
  if (!ageOk) knockouts.push(REASONS.ageOutsidePolicy);

  if (screening.status === "OK") {
    rules.push({
      id: "KO-SANCTIONS",
      name: "No sanctions or watchlist match",
      kind: "KNOCKOUT",
      result: screening.sanctionsMatch ? "FAIL" : "PASS",
      value: screening.sanctionsMatch ? "match" : "clear",
    });
    if (screening.sanctionsMatch) knockouts.push(REASONS.sanctionsMatch);
    rules.push({
      id: "KO-KYC",
      name: "Identity verified",
      kind: "KNOCKOUT",
      result: screening.kycVerified ? "PASS" : "FAIL",
      value: screening.kycVerified ? "verified" : "not verified",
    });
    if (!screening.kycVerified) knockouts.push(REASONS.identityNotVerified);
  } else {
    for (const [id, name] of [
      ["KO-SANCTIONS", "No sanctions or watchlist match"],
      ["KO-KYC", "Identity verified"],
    ] as const) {
      rules.push({
        id,
        name,
        kind: "KNOCKOUT",
        result: "NOT_EVALUATED",
        value: "screening unavailable",
      });
    }
  }

  if (bureau.status === "OK") {
    rules.push({
      id: "KO-DEFAULT",
      name: "No existing default",
      kind: "KNOCKOUT",
      result: bureau.existingDefault ? "FAIL" : "PASS",
      value: bureau.existingDefault ? "default reported" : "none",
    });
    if (bureau.existingDefault) knockouts.push(REASONS.existingDefault);
  } else {
    rules.push({
      id: "KO-DEFAULT",
      name: "No existing default",
      kind: "KNOCKOUT",
      result: "NOT_EVALUATED",
      value: "bureau unavailable",
    });
  }

  const base = { versions, ruleResults: rules, debtToIncome: dti };

  if (knockouts.length > 0) {
    return {
      ...base,
      outcome: DecisionOutcome.Decline,
      score: null,
      grade: null,
      scoreContributions: [],
      reasonCodes: knockouts,
      referralTriggers: [],
      monthlyRate: null,
    };
  }

  // --- Referral triggers that do not need a score ------------------------------------
  const amount = Money.of(application.amount);
  const aboveLimit = amount.greaterThan(Money.of(rs.autoApprovalLimit));
  rules.push({
    id: "RF-AMOUNT",
    name: "Amount within the automatic approval limit",
    kind: "REFERRAL",
    result: aboveLimit ? "FAIL" : "PASS",
    value: `limit ${rs.autoApprovalLimit}`,
  });
  if (aboveLimit) {
    triggers.push(REASONS.amountAboveAutoLimit.staff);
    add(REASONS.amountAboveAutoLimit);
  }

  const dtiHigh = income.isZero() || obligations.greaterThan(income.times(rs.maxDebtToIncome));
  rules.push({
    id: "RF-DTI",
    name: `Debt-to-income at or below ${ratioAsPercent(rs.maxDebtToIncome)}`,
    kind: "REFERRAL",
    result: dtiHigh ? "FAIL" : "PASS",
    value: dtiLabel,
  });
  if (dtiHigh) {
    triggers.push(REASONS.debtToIncome.staff);
    add(REASONS.debtToIncome);
  }

  if (screening.status === "UNAVAILABLE") {
    triggers.push(REASONS.screeningUnavailable.staff);
    add(REASONS.screeningUnavailable);
  }

  // --- Triggers added in RS-PL-2 (absent from earlier versions, so their records replay) --
  for (const reason of laterTriggers(inputs, rs, income, rules)) {
    triggers.push(reason.staff);
    add(reason);
  }

  // --- Bureau unavailable: refer without a score (never decline) ----------------------
  if (bureau.status === "UNAVAILABLE") {
    rules.push({
      id: "RF-BUREAU",
      name: "Credit bureau answered",
      kind: "REFERRAL",
      result: "FAIL",
      value: bureau.reason,
    });
    triggers.push(REASONS.bureauUnavailable.staff);
    add(REASONS.bureauUnavailable);
    return {
      ...base,
      outcome: DecisionOutcome.Refer,
      score: null,
      grade: null,
      scoreContributions: [],
      reasonCodes: reasons,
      referralTriggers: triggers,
      monthlyRate: null,
    };
  }

  const thin = bureau.fileDepth !== "FULL";
  rules.push({
    id: "RF-FILE",
    name: "Bureau file sufficient",
    kind: "REFERRAL",
    result: thin ? "FAIL" : "PASS",
    value: bureau.fileDepth === "NO_HIT" ? "no hit" : `${bureau.fileDepth.toLowerCase()} file`,
  });
  if (thin) {
    const reason = bureau.fileDepth === "NO_HIT" ? REASONS.noBureauHit : REASONS.thinFile;
    triggers.push(reason.staff);
    add(reason);
  }

  // --- Score and band -------------------------------------------------------------------
  const scored = score(sc, bureau, applicant, { obligations, income });
  const band = bandFor(scored.score, rs);
  rules.push({
    id: "SC-BAND",
    name: `Score band (decline below ${rs.declineBelow}, approve from ${rs.approveFrom})`,
    kind: "REFERRAL",
    result: band === "APPROVE" ? "PASS" : "FAIL",
    value: `score ${scored.score} (${scored.grade})`,
  });

  // A referral trigger sends the case to a person "regardless of score" (PRD glossary), so
  // a low score declines automatically only when nothing else asks for review; otherwise
  // the low score is one more reason for the reviewer.
  if (band === "DECLINE" && (triggers.length === 0 || rs.lowScoreWithTrigger === "DECLINE")) {
    const declineReasons: ReasonCode[] = [REASONS.scoreBelowMinimum];
    if (bureau.delinquencies12m > 0) declineReasons.push(REASONS.delinquencies);
    return {
      ...base,
      outcome: DecisionOutcome.Decline,
      score: scored.score,
      grade: scored.grade,
      scoreContributions: scored.contributions,
      reasonCodes: declineReasons,
      referralTriggers: [],
      monthlyRate: rs.monthlyRate[scored.grade],
    };
  }
  if (band === "DECLINE") {
    add(REASONS.scoreBelowMinimum);
    if (bureau.delinquencies12m > 0) add(REASONS.delinquencies);
  }
  if (band === "REFER") {
    triggers.push(REASONS.scoreInReferralBand.staff);
    add(REASONS.scoreInReferralBand);
  }
  const outcome = triggers.length > 0 ? DecisionOutcome.Refer : DecisionOutcome.Approve;

  return {
    ...base,
    outcome,
    score: scored.score,
    grade: scored.grade,
    scoreContributions: scored.contributions,
    reasonCodes: outcome === DecisionOutcome.Refer ? reasons : [],
    referralTriggers: outcome === DecisionOutcome.Refer ? triggers : [],
    monthlyRate: rs.monthlyRate[scored.grade],
  };
}

/**
 * The referral triggers a rule set turns on with its optional fields: income mismatch,
 * related party and fraud (RS-PL-2). Appends their rule results; returns the reasons that
 * fired. A version that asks for an input the snapshot lacks is refused, so a record can
 * never be decided or replayed on inputs its rule set does not describe.
 */
function laterTriggers(
  inputs: DecisionInputs,
  rs: RuleSet,
  income: Money,
  rules: RuleResult[],
): ReasonCode[] {
  const fired: ReasonCode[] = [];
  const missing = (what: string) =>
    new Error(`Rule set ${rs.version} needs ${what} in the decision inputs`);

  if (rs.incomeMismatchTolerance !== undefined) {
    const declaredRaw = inputs.applicant.declaredMonthlyIncome;
    if (declaredRaw === undefined) throw missing("the declared income");
    const tolerance = rs.incomeMismatchTolerance;
    const name = `Declared and verified income within ${ratioAsPercent(tolerance)}`;
    if (declaredRaw === null) {
      rules.push({
        id: "RF-INCOME",
        name,
        kind: "REFERRAL",
        result: "NOT_EVALUATED",
        value: "no separate declaration",
      });
    } else {
      // Exact: |declared − verified| > verified × tolerance. No verified income: any declared
      // income is a mismatch.
      const declared = Money.of(declaredRaw);
      const gap = declared.greaterThan(income) ? declared.minus(income) : income.minus(declared);
      const mismatch = income.isZero()
        ? !declared.isZero()
        : gap.greaterThan(income.times(tolerance));
      rules.push({
        id: "RF-INCOME",
        name,
        kind: "REFERRAL",
        result: mismatch ? "FAIL" : "PASS",
        value: income.isZero()
          ? "no verified income"
          : `differs by ${ratioAsPercent(gap.ratioTo(income))}`,
      });
      if (mismatch) fired.push(REASONS.incomeMismatch);
    }
  }

  if (rs.relatedPartyReferral) {
    const related = inputs.applicant.relatedParty;
    if (related === undefined) throw missing("the related-party flag");
    rules.push({
      id: "RF-RELATED",
      name: "Not a related party or insider",
      kind: "REFERRAL",
      result: related ? "FAIL" : "PASS",
      value: related ? "related party" : "none",
    });
    if (related) fired.push(REASONS.relatedParty);
  }

  if (rs.fraudCheck) {
    const fraud = inputs.fraud;
    if (fraud === undefined) throw missing("the fraud check");
    if (fraud.status === "OK") {
      rules.push({
        id: "RF-FRAUD",
        name: "No fraud or identity flag",
        kind: "REFERRAL",
        result: fraud.flagged ? "FAIL" : "PASS",
        value: fraud.flagged
          ? fraud.signals.map((s) => s.toLowerCase().replaceAll("_", " ")).join(", ") || "flagged"
          : "clear",
      });
      if (fraud.flagged) fired.push(REASONS.fraudFlag);
    } else {
      // An unanswered fraud check refers, never declines (PRD NFR-005).
      rules.push({
        id: "RF-FRAUD",
        name: "No fraud or identity flag",
        kind: "REFERRAL",
        result: "NOT_EVALUATED",
        value: "fraud check unavailable",
      });
      fired.push(REASONS.fraudUnavailable);
    }
  }
  return fired;
}

const MODE_WORDS: Record<AutomationMode, string> = {
  OFF: "automation off",
  SHADOW: "shadow mode",
  LIVE: "live",
};

const OUTCOME_WORDS: Record<DecisionOutcome, string> = {
  AUTO_APPROVE: "auto-approve",
  REFER: "refer",
  AUTO_DECLINE: "auto-decline",
};

/**
 * The product's automation mode and kill switch (PRD §7.5). Live with the switch off: the
 * engine's outcome stands. Otherwise the case goes to a person (a knockout too: a person
 * declines it), with the score, grade and the engine's own reasons kept for the reviewer.
 * Only rule sets with `automationModes` (RS-PL-2 on) apply it; RS-PL-1 records carry no
 * `automation` and come back unchanged.
 */
function applyAutomation(
  result: DecisionResult,
  automation: DecisionInputs["automation"],
): DecisionResult {
  if (!automation) return result;
  const live = automation.mode === AutomationMode.Live && !automation.killSwitch;
  const rule: RuleResult = {
    id: "AU-MODE",
    name: "Automated decisions live for this product",
    kind: "REFERRAL",
    result: live ? "PASS" : "FAIL",
    value: automation.killSwitch ? "kill switch on" : MODE_WORDS[automation.mode],
  };
  const ruleResults = [...result.ruleResults, rule];
  if (live) return { ...result, ruleResults };

  const reason = automation.killSwitch
    ? REASONS.killSwitch
    : automation.mode === AutomationMode.Off
      ? REASONS.automationOff
      : REASONS.shadowMode;
  return {
    ...result,
    ruleResults,
    outcome: DecisionOutcome.Refer,
    reasonCodes: [reason, ...result.reasonCodes.filter((r) => r.code !== reason.code)],
    referralTriggers: [
      `${reason.staff} (the engine's outcome: ${OUTCOME_WORDS[result.engineOutcome]})`,
      ...result.referralTriggers,
    ],
  };
}

/** The score band for a score: approve from `approveFrom`, decline below `declineBelow`. */
export function bandFor(scoreValue: number, rs: RuleSet): "APPROVE" | "REFER" | "DECLINE" {
  if (scoreValue >= rs.approveFrom) return "APPROVE";
  if (scoreValue < rs.declineBelow) return "DECLINE";
  return "REFER";
}

/** Canonical JSON (keys sorted at every level) so equal inputs always hash the same. */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

/** SHA-256 of the canonical input snapshot, stored with the decision record. */
export function hashInputs(inputs: DecisionInputs): string {
  return createHash("sha256").update(canonicalJson(inputs)).digest("hex");
}
