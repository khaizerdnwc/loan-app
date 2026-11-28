import { DecisionOutcome, type HarnessRow } from "@loan/core";
import { decide } from "./decide";
import { type RuleSet, ruleSet } from "./rule-sets";
import type { DecisionInputs, DecisionResult } from "./types";

/**
 * The rule-set test harness (PRD DEC-004, F8 step 1). It is not a decision step: it replays
 * stored snapshots under two versions to compare them, and nothing it computes is stored as a
 * decision, so no stored record's replay depends on it.
 */

const OUTCOMES = Object.values(DecisionOutcome);

/** A stored decision as the harness replays it. */
export interface HarnessSnapshot {
  caseReference: string;
  inputs: DecisionInputs;
  /** The scorecard the decision ran on: both versions are replayed with it, held constant. */
  scorecardVersion: string;
}

type Adapted = { inputs: DecisionInputs; defaults: string[] } | { notComparable: string };

/**
 * A stored snapshot made fit for a rule set. Inputs a version needs and the snapshot lacks get
 * a stated neutral default, listed; inputs a version does not read are dropped. An input that
 * would mean inventing a provider's answer (the fraud check) is never guessed: the snapshot is
 * not comparable. Automation is set to live for every version, because the harness compares
 * the rules' own outcome (`engineOutcome`), before any mode.
 */
export function adaptInputs(stored: DecisionInputs, rs: RuleSet): Adapted {
  if (stored.application.productCode !== rs.productCode) {
    return { notComparable: `product ${stored.application.productCode}, not ${rs.productCode}` };
  }
  const defaults: string[] = [];
  const applicant = { ...stored.applicant };
  if (rs.incomeMismatchTolerance !== undefined) {
    if (applicant.declaredMonthlyIncome === undefined) {
      applicant.declaredMonthlyIncome = null;
      defaults.push("declared income: no separate declaration (not recorded)");
    }
  } else {
    delete applicant.declaredMonthlyIncome;
  }
  if (rs.relatedPartyReferral) {
    if (applicant.relatedParty === undefined) {
      applicant.relatedParty = false;
      defaults.push("related party: not a related party (not recorded)");
    }
  } else {
    delete applicant.relatedParty;
  }
  const inputs: DecisionInputs = { ...stored, applicant };
  if (rs.fraudCheck) {
    if (!stored.fraud) return { notComparable: `${rs.version} needs a fraud check result` };
  } else {
    delete inputs.fraud;
  }
  if (rs.automationModes) inputs.automation = { mode: "LIVE", killSwitch: false };
  else delete inputs.automation;
  if (rs.externalEngine) {
    if (!stored.external) {
      inputs.external = { role: "NONE" };
      defaults.push("external decision engine: not used (not recorded)");
    }
  } else {
    if (stored.external && stored.external.role !== "NONE") {
      defaults.push(`external decision engine answer left out (${rs.version} has no such step)`);
    }
    delete inputs.external;
  }
  return { inputs, defaults };
}

/** A decision under one version, or null when the engine refuses the snapshot (any error). */
function replay(
  inputs: DecisionInputs,
  ruleSetVersion: string,
  scorecardVersion: string,
): DecisionResult | null {
  try {
    return decide(inputs, { ruleSet: ruleSetVersion, scorecard: scorecardVersion });
  } catch {
    // The error is dropped on purpose: its message may quote applicant figures.
    return null;
  }
}

export interface HarnessResult {
  compared: number;
  notComparable: { caseReference: string; reason: string }[];
  outcomes: { outcome: DecisionOutcome; baseline: number; candidate: number }[];
  movement: { from: DecisionOutcome; to: DecisionOutcome; count: number }[];
  changed: HarnessRow[];
  withDefaults: HarnessRow[];
}

/**
 * Replay each snapshot under the baseline and the candidate rule set and compare their outcomes
 * and reason codes. Pure: no clock, no database, nothing written.
 */
export function runHarness(
  snapshots: HarnessSnapshot[],
  candidateVersion: string,
  baselineVersion: string,
): HarnessResult {
  const candidate = ruleSet(candidateVersion);
  const baseline = ruleSet(baselineVersion);
  const tally = new Map(OUTCOMES.map((o) => [o, { baseline: 0, candidate: 0 }]));
  const moves = new Map<string, number>();
  const notComparable: HarnessResult["notComparable"] = [];
  const changed: HarnessRow[] = [];
  const withDefaults: HarnessRow[] = [];
  let compared = 0;

  for (const s of snapshots) {
    const b = adaptInputs(s.inputs, baseline);
    const c = adaptInputs(s.inputs, candidate);
    if ("notComparable" in b) {
      notComparable.push({ caseReference: s.caseReference, reason: b.notComparable });
      continue;
    }
    if ("notComparable" in c) {
      notComparable.push({ caseReference: s.caseReference, reason: c.notComparable });
      continue;
    }
    const from = replay(b.inputs, baseline.version, s.scorecardVersion);
    const to = from && replay(c.inputs, candidate.version, s.scorecardVersion);
    if (!from || !to) {
      // One snapshot the engine refuses is listed, not fatal to the run. The engine's own
      // message is never passed on: band and parse errors quote the applicant's figures. The
      // reason is fixed text naming only the rule-set version the harness was asked for.
      notComparable.push({
        caseReference: s.caseReference,
        reason: `The engine could not replay this decision under ${from ? candidate.version : baseline.version}.`,
      });
      continue;
    }
    compared += 1;
    const fromOutcome = from.engineOutcome;
    const toOutcome = to.engineOutcome;
    const before = tally.get(fromOutcome);
    if (before) before.baseline += 1;
    const after = tally.get(toOutcome);
    if (after) after.candidate += 1;
    const key = `${fromOutcome}>${toOutcome}`;
    moves.set(key, (moves.get(key) ?? 0) + 1);

    const fromCodes = from.reasonCodes.map((r) => r.code);
    const toCodes = to.reasonCodes.map((r) => r.code);
    const row: HarnessRow = {
      caseReference: s.caseReference,
      baselineOutcome: fromOutcome,
      candidateOutcome: toOutcome,
      reasonsAdded: to.reasonCodes
        .filter((r) => !fromCodes.includes(r.code))
        .map(({ code, staff }) => ({ code, staff })),
      reasonsRemoved: from.reasonCodes
        .filter((r) => !toCodes.includes(r.code))
        .map(({ code, staff }) => ({ code, staff })),
      defaults: [...new Set([...b.defaults, ...c.defaults])],
    };
    if (fromOutcome !== toOutcome || row.reasonsAdded.length > 0 || row.reasonsRemoved.length > 0) {
      changed.push(row);
    }
    if (row.defaults.length > 0) withDefaults.push(row);
  }

  return {
    compared,
    notComparable,
    outcomes: OUTCOMES.map((outcome) => ({
      outcome,
      ...(tally.get(outcome) ?? { baseline: 0, candidate: 0 }),
    })),
    movement: OUTCOMES.flatMap((f) =>
      OUTCOMES.map((t) => ({ from: f, to: t, count: moves.get(`${f}>${t}`) ?? 0 })),
    ),
    changed,
    withDefaults,
  };
}
