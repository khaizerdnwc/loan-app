import type { ReasonCode } from "./types";

/**
 * Standardised reason codes (PRD LND-DEC-007). The wording names no threshold: thresholds
 * belong to a versioned rule set and are shown in the rule results, so this catalogue does
 * not have to change when a new rule set does. Staff wording explains the decision; the
 * borrower wording is safe to show an applicant (no scores, no thresholds, no list names).
 */
export const REASONS = {
  thinFile: {
    code: "R01",
    staff: "Thin bureau file: too little credit history to score with confidence",
    borrower: "We could not confirm enough credit history.",
  },
  debtToIncome: {
    code: "R02",
    staff: "Debt-to-income above the policy cap",
    borrower: "Your current repayments are high compared with your income.",
  },
  delinquencies: {
    code: "R04",
    staff: "Recent missed payments on other credit",
    borrower: "Your recent repayment history does not meet our requirements.",
  },
  amountAboveAutoLimit: {
    code: "R05",
    staff: "Amount above the automatic approval limit",
    borrower: "Your application needs a review by our credit team.",
  },
  scoreInReferralBand: {
    code: "R06",
    staff: "Score in the referral band",
    borrower: "Your application needs a review by our credit team.",
  },
  scoreBelowMinimum: {
    code: "R07",
    staff: "Score below the minimum for this product",
    borrower: "Your application does not meet our credit requirements.",
  },
  noBureauHit: {
    code: "R08",
    staff: "No record at the credit bureau",
    borrower: "We could not confirm enough credit history.",
  },
  ageOutsidePolicy: {
    code: "R09",
    staff: "Applicant age outside the policy range",
    borrower: "Your application does not meet our lending requirements.",
  },
  bureauUnavailable: {
    code: "R10",
    staff: "Credit bureau unavailable: routed to manual review instead of declining",
    borrower: "Your application needs a review by our credit team.",
  },
  sanctionsMatch: {
    code: "R11",
    staff: "Sanctions or watchlist match",
    borrower: "Your application does not meet our lending requirements.",
  },
  existingDefault: {
    code: "R12",
    staff: "Existing default reported by the bureau",
    borrower: "Your application does not meet our lending requirements.",
  },
  screeningUnavailable: {
    code: "R13",
    staff: "KYC/AML screening unavailable: routed to manual review",
    borrower: "Your application needs a review by our credit team.",
  },
  identityNotVerified: {
    code: "R14",
    staff: "Identity could not be verified",
    borrower: "We could not verify your identity.",
  },
  incomeMismatch: {
    code: "R15",
    staff: "Declared income differs from verified income by more than the policy tolerance",
    borrower: "We need to confirm your income.",
  },
  fraudFlag: {
    code: "R16",
    staff: "Fraud or identity signal raised by the fraud check",
    borrower: "Your application needs a review by our credit team.",
  },
  fraudUnavailable: {
    code: "R17",
    staff: "Fraud check unavailable: routed to manual review",
    borrower: "Your application needs a review by our credit team.",
  },
  relatedParty: {
    code: "R18",
    staff: "Related party or insider applicant: review is mandatory",
    borrower: "Your application needs a review by our credit team.",
  },
  automationOff: {
    code: "R19",
    staff: "Automation off for this product: every application goes to a person",
    borrower: "Your application needs a review by our credit team.",
  },
  shadowMode: {
    code: "R20",
    staff: "Shadow mode: the engine's outcome is recorded and a person decides",
    borrower: "Your application needs a review by our credit team.",
  },
  killSwitch: {
    code: "R21",
    staff: "Kill switch on: every new application goes to manual review",
    borrower: "Your application needs a review by our credit team.",
  },
} as const satisfies Record<string, ReasonCode>;
