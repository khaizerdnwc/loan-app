import { CONSENT_TERMS_VERSION } from "@loan/core";

/** Staff capture consent on the applicant's behalf at a branch in this release. */
export const CONSENT_CHANNEL = "BRANCH_ASSISTED";

/** Both consents given, for the current terms: the application may be submitted (INT-006). */
export function consentComplete(
  consent: { creditBureauCheck: boolean; dataProcessing: boolean; termsVersion: string } | null,
): boolean {
  return (
    !!consent &&
    consent.creditBureauCheck &&
    consent.dataProcessing &&
    consent.termsVersion === CONSENT_TERMS_VERSION
  );
}
