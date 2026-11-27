import { createHash } from "node:crypto";
import { DecisionOutcome, Money } from "@loan/core";
import { ratioAsPercent } from "./ratio";
import { REASONS } from "./reason-codes";
import { type RuleSet, ruleSet } from "./rule-sets";
import { score, scorecard } from "./scorecards";
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
 * decline (PRD NFR-005).
 */
export function decide(inputs: DecisionInputs, versions: DecisionVersions): DecisionResult {
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
