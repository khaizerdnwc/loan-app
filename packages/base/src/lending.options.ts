import type { ResilienceOptions } from "./providers/resilience";

/** What the composition root tells the lending module about where it runs. */
export interface LendingModuleOptions {
  jwtSecret: string;
  /** Send the session cookie only over HTTPS (true outside local development and tests). */
  cookieSecure: boolean;
  /** Retry, circuit breaker and bureau reuse for the decision's providers (defaults apply). */
  resilience?: Partial<ResilienceOptions>;
}

export const LENDING_OPTIONS = "LENDING_MODULE_OPTIONS";
