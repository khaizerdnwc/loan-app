import type { ProviderMode, ScreeningStage } from "@loan/core";
import type { ApplicantIdentity } from "./applicant-identity";

export interface ScreeningResult {
  provider: string;
  mode: ProviderMode;
  /** Identity verified against the ID on file. */
  kycVerified: boolean;
  /** A sanctions or watchlist match (a policy knockout). */
  sanctionsMatch: boolean;
  /** Which list matched, when one did. */
  matchedList: string | null;
  politicallyExposed: boolean;
  screenedAt: string;
}

export interface KycAml {
  readonly mode: ProviderMode;
  /**
   * Throws ProviderUnavailableError when screening cannot complete. `stage` says why the
   * screening runs: at application (the default) or again before disbursement (PRD CMP-005),
   * when the lists may have changed since onboarding.
   */
  screen(subject: ApplicantIdentity, stage?: ScreeningStage): Promise<ScreeningResult>;
}

export const KYC_AML = "KYC_AML_PORT";
