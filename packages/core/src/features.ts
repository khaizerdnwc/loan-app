/**
 * Feature flags (PRD PLT-006: "switch modules on or off for the bank"). Each flag switches one
 * optional module; the API refuses a switched-off module's routes, and the backoffice hides it.
 * A change is drafted by one administrator and takes effect when a second approves it.
 */
export const FeatureFlag = {
  /** The eligibility pre-check at the counter (PRD PC-008). */
  EligibilityPrecheck: "ELIGIBILITY_PRECHECK",
  /** Email and file intake: uploads read by OCR into drafts for review (PRD INT-010, F4). */
  EmailIntake: "EMAIL_INTAKE",
} as const;
export type FeatureFlag = (typeof FeatureFlag)[keyof typeof FeatureFlag];

export const FEATURE_FLAGS: readonly FeatureFlag[] = Object.values(FeatureFlag);

export const FEATURE_FLAG_LABEL: Record<FeatureFlag, string> = {
  ELIGIBILITY_PRECHECK: "Eligibility pre-check",
  EMAIL_INTAKE: "Email and file intake",
};

/** Which modules are on, for every signed-in user (the backoffice hides what is off). */
export type FeatureStateView = Record<FeatureFlag, boolean>;

export interface FeatureFlagChangeView {
  id: string;
  /** What the flag would become. */
  enabled: boolean;
  reason: string;
  requestedByName: string;
  requestedAt: string;
}

/** A flag as administrators see it: its state, a pending change, and what they may do. */
export interface FeatureFlagView {
  key: FeatureFlag;
  label: string;
  enabled: boolean;
  updatedAt: string;
  updatedByName: string | null;
  pendingChange: FeatureFlagChangeView | null;
  allowedActions: {
    /** Draft a change (none pending). */
    request: boolean;
    /** Approve the pending change (drafted by someone else). */
    approve: boolean;
    /** Reject the pending change (any administrator; the drafter may withdraw their own). */
    reject: boolean;
    /** Why approving is not offered, when there is a pending change. */
    approveBlockedReason: string | null;
  };
}

export interface FeatureFlagChangeRequest {
  enabled: boolean;
  reason: string;
}

export interface FeatureFlagDecisionRequest {
  note?: string;
}
