import type { DecisionOutcome, Grade, OverrideReason, Recommendation } from "./domain";

/**
 * Model governance (PRD AIS-008, AIS-009, AIS-011, AIS-012, CMP-008): the registry of the
 * scorecards and rule sets decisions ran on, the prohibited-features check, how often people
 * override the engine, and whether the score distribution is drifting. Read by administrators
 * and compliance.
 */
export interface ScorecardRegistryEntry {
  version: string;
  current: boolean;
  /** The attributes the points read. */
  features: string[];
  /** Prohibited attributes it reads; empty when the check passes. */
  prohibitedFeatures: string[];
  /** Whether it carries a probability of default per grade. */
  hasPd: boolean;
  decisions: number;
  firstUsedAt: string | null;
  lastUsedAt: string | null;
}

export interface RuleSetRegistryEntry {
  version: string;
  current: boolean;
  decisions: number;
  firstUsedAt: string | null;
  lastUsedAt: string | null;
}

export interface ModelRegistryView {
  scorecards: ScorecardRegistryEntry[];
  ruleSets: RuleSetRegistryEntry[];
  /** Attributes no scorecard may use. */
  prohibitedFeatures: string[];
}

export interface OverrideMonitorView {
  since: string;
  /** Recommendations loan officers sent to an approver in the window. */
  recommendations: number;
  /** Of those, overrides (a decline, or a counter-offer that changes the scored terms). */
  overrides: number;
  byReason: { code: OverrideReason; count: number }[];
  /** The engine's own outcome against what the officer recommended. */
  matrix: { engineOutcome: DecisionOutcome; recommendation: Recommendation; count: number }[];
  /**
   * Shadow and automation-off decisions, where the engine's outcome was only recorded: how
   * often the person reached the same outcome (approve ↔ approve or counter-offer, decline ↔
   * decline). Referred engine outcomes are not compared.
   */
  notLive: { compared: number; agreed: number };
}

export type DriftStatus = "STABLE" | "MODERATE" | "SIGNIFICANT" | "INSUFFICIENT_DATA";

export interface DriftView {
  baseline: { from: string; to: string; decisions: number; meanScore: number | null };
  recent: { from: string; to: string; decisions: number; meanScore: number | null };
  /** Share of scored decisions per grade, as percentages with one decimal. */
  grades: { grade: Grade; baselinePct: number; recentPct: number }[];
  /**
   * Population stability index over the grade shares, four decimals ("0.0123"); null when a
   * window has fewer than `minimumDecisions` scored decisions (status INSUFFICIENT_DATA).
   */
  psi: string | null;
  status: DriftStatus;
  /** Each window needs at least this many scored decisions for a status. */
  minimumDecisions: number;
}

/**
 * Plain words for the attributes a scorecard reads and the prohibited ones (the registry shows
 * these; the identifier stays available beside them).
 */
export const FEATURE_LABEL: Readonly<Record<string, string>> = {
  "bureau.bureauScore": "Bureau score",
  "bureau.fileDepth": "Depth of the bureau file",
  "bureau.utilisationPct": "Credit utilisation",
  "bureau.delinquencies12m": "Missed payments in the last 12 months",
  "applicant.debtToIncome": "Debt-to-income",
  "applicant.employmentMonths": "Time in employment",
  "applicant.relationshipMonths": "Time as a WhiteBank customer",
  "applicant.sex": "Sex",
  "applicant.gender": "Gender",
  "applicant.civilStatus": "Civil status",
  "applicant.religion": "Religion",
  "applicant.ethnicity": "Ethnicity",
  "applicant.disability": "Disability",
  "applicant.politicalAffiliation": "Political affiliation",
  "applicant.ageYears": "Age",
  "applicant.birthPlace": "Place of birth",
};

/** A feature in words, or its identifier when no label is known. */
export function featureLabel(feature: string): string {
  return FEATURE_LABEL[feature] ?? feature;
}

/**
 * The rule-set test harness (PRD DEC-004, F8 step 1): stored decisions replayed under a
 * candidate rule set and a baseline (the live version by default), compared. Read-only: it
 * compares, it never publishes, writes a decision or calls a provider. Counts and case
 * references only.
 */
export interface HarnessRunRequest {
  candidate: string;
  /** Default: the live (current) rule set. */
  baseline?: string;
  /** Business dates, inclusive (default the last 30 days; at most 366). */
  from?: string;
  to?: string;
}

/** One decision the harness replayed: its case reference and what changed. */
export interface HarnessRow {
  caseReference: string;
  baselineOutcome: DecisionOutcome;
  candidateOutcome: DecisionOutcome;
  /**
   * Reason codes the candidate gives that the baseline does not, and the reverse, each with its
   * staff wording from the engine (so the screen keeps no code table).
   */
  reasonsAdded: { code: string; staff: string }[];
  reasonsRemoved: { code: string; staff: string }[];
  /** Inputs the snapshot lacked, filled with a stated neutral default for a version. */
  defaults: string[];
}

export interface HarnessRunView {
  candidate: string;
  baseline: string;
  period: { from: string; to: string };
  /** At most this many decisions are replayed (each case's latest in the period, newest first). */
  cap: number;
  /** Cases with a decision in the period; more than `cap` means only the newest `cap` ran. */
  decisionsInPeriod: number;
  compared: number;
  /** Snapshots that could not be replayed under a version, never guessed. */
  notComparable: { caseReference: string; reason: string }[];
  /** Outcomes (before any automation mode) under each version. */
  outcomes: { outcome: DecisionOutcome; baseline: number; candidate: number }[];
  /** How many compared decisions went from each baseline outcome to each candidate outcome. */
  movement: { from: DecisionOutcome; to: DecisionOutcome; count: number }[];
  /** Compared decisions whose outcome or reason codes differ. */
  changed: HarnessRow[];
  /** Compared decisions that used a default for a missing input (changed or not). */
  withDefaults: HarnessRow[];
}
