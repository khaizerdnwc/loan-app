import type { ProviderMode } from "@loan/core";
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
  /** Throws ProviderUnavailableError when screening cannot complete. */
  screen(subject: ApplicantIdentity): Promise<ScreeningResult>;
}

export const KYC_AML = "KYC_AML_PORT";
