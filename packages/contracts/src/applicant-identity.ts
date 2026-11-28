/**
 * Who an external check is about. Shared by every port that looks a person up (bureau,
 * KYC/AML), so no port depends on another port's types. Synthetic personas only.
 */
export interface ApplicantIdentity {
  applicantId: string;
  fullName: string;
  birthDate: string;
  governmentIdLast4: string;
}

/**
 * The person, not the bank's record of them: name (case and spacing ignored), birth date and
 * the last 4 digits of the government ID. A provider that screens people matches on this, so
 * capturing the same person again under a new applicant id finds the same answer.
 */
export function identityKey(identity: Omit<ApplicantIdentity, "applicantId">): string {
  const name = identity.fullName.trim().replace(/\s+/g, " ").toLowerCase();
  return `${name}|${identity.birthDate}|${identity.governmentIdLast4}`;
}
