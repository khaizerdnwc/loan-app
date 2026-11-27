import type { ServiceName } from "./domain";

/**
 * Provider resilience and cost (PRD IH-003, IH-005, IH-006) and decision latency (NFR-003,
 * AIS-001). Read by administrators and compliance.
 */
export type CircuitState = "CLOSED" | "OPEN" | "HALF_OPEN";

export interface ProviderServiceUsage {
  service: ServiceName;
  /** Attempts that reached the provider (retries included). */
  attempts: number;
  ok: number;
  failed: number;
  /** Calls refused at once because the service's circuit was open. */
  shortCircuited: number;
  /** Bureau reports reused within the reuse window instead of a new pull. */
  cacheHits: number;
  /** Simulated price of the successful calls, decimal string. */
  cost: string;
  circuit: { state: CircuitState; consecutiveFailures: number; openUntil: string | null };
}

export interface ProviderUsageView {
  /** Start of the window (ISO 8601); the window ends now. */
  since: string;
  services: ProviderServiceUsage[];
  totalCost: string;
}

/** Time from gathering a decision's inputs to its record being written. */
export interface DecisionLatencyView {
  since: string;
  /** Decisions in the window that carry a measurement. */
  decisions: number;
  p50Ms: number | null;
  p95Ms: number | null;
  maxMs: number | null;
  /** PRD NFR-003: an automated decision within 60 seconds, 95th percentile. */
  targetP95Ms: number;
}
