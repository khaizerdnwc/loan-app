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
