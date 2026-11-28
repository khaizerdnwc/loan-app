import type { ProviderMode } from "@loan/core";

/** What a client's own decision engine answers (PRD DEC-008). */
export type ExternalDecision = "APPROVE" | "REFER" | "DECLINE";

/**
 * What the external engine is sent: the application terms, the income figures and the bureau
 * score the built-in engine also read. No name, birth date or government ID: the engine only
 * needs the synthetic applicant reference to correlate its own records.
 */
export interface ExternalDecisionRequest {
  applicantId: string;
  productCode: string;
  /** Decimal strings (exact money). */
  amount: string;
  tenorMonths: number;
  monthlyIncome: string;
  monthlyObligations: string;
  /** Null when the bureau had no score or could not answer. */
  bureauScore: number | null;
}

export interface ExternalDecisionReply {
  /** Display name, e.g. "Client decision engine (simulated)". */
  provider: string;
  mode: ProviderMode;
  decision: ExternalDecision;
  /** The external engine's own reason codes, kept verbatim for the reviewer. */
  reasonCodes: string[];
  /** The external engine's reference for this evaluation. */
  reference: string;
  decidedAt: string;
}

export interface ExternalDecisionEngine {
  /** Simulated or real: must match the other decision providers' mode. */
  readonly mode: ProviderMode;
  /** Throws ProviderUnavailableError when the engine cannot answer. */
  evaluate(request: ExternalDecisionRequest): Promise<ExternalDecisionReply>;
}

/** Nest injection token for the ExternalDecisionEngine port. */
export const EXTERNAL_DECISION_ENGINE = "EXTERNAL_DECISION_ENGINE_PORT";
