import type { ProviderMode } from "@loan/core";
import type { ApplicantIdentity } from "./applicant-identity";

export type FileDepth = "FULL" | "THIN" | "NO_HIT";

/** The part of a credit report the decision uses. */
export interface BureauReport {
  /** Display name of the provider, e.g. "Credit bureau (simulated)". */
  provider: string;
  mode: ProviderMode;
  fileDepth: FileDepth;
  /** Bureau's own score (300–850), null when there is no hit. */
  bureauScore: number | null;
  tradeLines: number;
  /** Revolving utilisation, whole percent 0–100. */
  utilisationPct: number;
  delinquencies12m: number;
  existingDefault: boolean;
  monthsOnFile: number;
  retrievedAt: string;
}

export interface CreditBureau {
  /** Simulated or real: stored on every decision record that used this bureau. */
  readonly mode: ProviderMode;
  /** Throws ProviderUnavailableError when the bureau cannot answer. */
  pull(subject: ApplicantIdentity): Promise<BureauReport>;
}

/** Nest injection token for the CreditBureau port. */
export const CREDIT_BUREAU = "CREDIT_BUREAU_PORT";
