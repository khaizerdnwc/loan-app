import type { ProviderMode } from "@loan/core";
import type { ApplicantIdentity } from "./applicant-identity";

/**
 * The rules-based fraud signals the PRD asks for before a fraud provider is chosen (§9.5:
 * "velocity, duplicate identities, mismatched data").
 */
export type FraudSignal = "VELOCITY" | "DUPLICATE_IDENTITY" | "MISMATCHED_DATA";

export interface FraudAssessment {
  /** Display name of the provider, e.g. "Fraud signals (simulated)". */
  provider: string;
  mode: ProviderMode;
  /** A fraud or identity flag: the case goes to a person (PRD DEC-006). */
  flagged: boolean;
  /** Which signals fired; empty when not flagged. */
  signals: FraudSignal[];
  assessedAt: string;
}

export interface FraudCheck {
  /** Simulated or real: must match the bureau's and screening's mode on a decision record. */
  readonly mode: ProviderMode;
  /** Throws ProviderUnavailableError when the check cannot complete. */
  assess(subject: ApplicantIdentity): Promise<FraudAssessment>;
}

/** Nest injection token for the FraudCheck port. */
export const FRAUD_CHECK = "FRAUD_CHECK_PORT";
