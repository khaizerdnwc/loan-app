import type { ServiceName } from "@loan/core";

export type ProviderFailure = "OUTAGE" | "TIMEOUT" | "MALFORMED";

/**
 * Every port throws this, and only this, when its provider cannot answer: down, too slow, or
 * replying with something that does not parse. Workflow code turns it into a safe outcome
 * (a referral, a failed booking that can be retried) — never into a decline (PRD NFR-005).
 */
export class ProviderUnavailableError extends Error {
  readonly code = "PROVIDER_UNAVAILABLE";

  constructor(
    readonly service: ServiceName,
    readonly failure: ProviderFailure,
    message: string,
  ) {
    super(message);
    this.name = "ProviderUnavailableError";
  }
}

export function isProviderUnavailable(err: unknown): err is ProviderUnavailableError {
  return err instanceof ProviderUnavailableError;
}
