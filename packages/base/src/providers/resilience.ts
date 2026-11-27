import { isProviderUnavailable, ProviderUnavailableError } from "@loan/contracts";
import type { CircuitState, ServiceName } from "@loan/core";

/**
 * Retry with backoff and a circuit breaker for the decision's provider calls (PRD IH-003).
 * Pure of I/O: the clock and the sleep are passed in, so the policy is unit-tested without
 * waiting. Only ProviderUnavailableError (outage, timeout, malformed reply) is retried or
 * counted; anything else is a bug and passes straight through.
 */
export interface ResilienceOptions {
  /** Attempts per call, the first included (1 = no retry). */
  retryAttempts: number;
  /** Backoff before attempt k+1: base × 2^(k−1), plus up to `base` of jitter. */
  retryBaseMs: number;
  /** Consecutive failed calls (after their retries) that open a service's circuit. */
  circuitThreshold: number;
  /** How long an open circuit refuses calls before letting one trial through. */
  circuitOpenMs: number;
  /** Days a bureau report is reused for the same applicant (PRD IH-005: 30). */
  bureauCacheDays: number;
}

export const DEFAULT_RESILIENCE: ResilienceOptions = {
  retryAttempts: 3,
  retryBaseMs: 200,
  circuitThreshold: 5,
  circuitOpenMs: 30_000,
  bureauCacheDays: 30,
};

/** The delay before retry number `retry` (1-based), given a jitter in [0, base). */
export function backoffMs(base: number, retry: number, jitter: number): number {
  return base * 2 ** (retry - 1) + jitter;
}

export interface AttemptReport {
  attempt: number;
  ok: boolean;
  failure: string | null;
  durationMs: number;
}

/**
 * Call `fn` up to `attempts` times while it fails with ProviderUnavailableError, sleeping a
 * growing backoff between tries. Reports every attempt (for the cost counter). Rethrows the
 * last provider error when every attempt failed.
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  opts: {
    attempts: number;
    baseMs: number;
    sleep: (ms: number) => Promise<void>;
    jitter: (base: number) => number;
    now: () => number;
    onAttempt: (report: AttemptReport) => Promise<void> | void;
  },
): Promise<T> {
  let last: unknown;
  for (let attempt = 1; attempt <= Math.max(1, opts.attempts); attempt++) {
    if (attempt > 1)
      await opts.sleep(backoffMs(opts.baseMs, attempt - 1, opts.jitter(opts.baseMs)));
    const started = opts.now();
    try {
      const value = await fn();
      await opts.onAttempt({ attempt, ok: true, failure: null, durationMs: opts.now() - started });
      return value;
    } catch (err) {
      if (!isProviderUnavailable(err)) throw err;
      await opts.onAttempt({
        attempt,
        ok: false,
        failure: err.failure,
        durationMs: opts.now() - started,
      });
      last = err;
    }
  }
  throw last;
}

interface Circuit {
  failures: number;
  openUntil: number | null;
  trialInFlight: boolean;
}

/**
 * One circuit per service, in this API instance's memory (a restart closes them all; several
 * instances keep separate circuits, ASSUMPTIONS "Provider resilience"). Closed: calls go
 * through. After `threshold` consecutive failed calls it opens and refuses calls at once for
 * `openMs`. Then half-open: one trial call; success closes it, failure opens it again.
 */
export class CircuitBreaker {
  private readonly circuits = new Map<ServiceName, Circuit>();

  constructor(
    private readonly threshold: number,
    private readonly openMs: number,
    private readonly now: () => number,
  ) {}

  private circuit(service: ServiceName): Circuit {
    let c = this.circuits.get(service);
    if (!c) {
      c = { failures: 0, openUntil: null, trialInFlight: false };
      this.circuits.set(service, c);
    }
    return c;
  }

  state(service: ServiceName): {
    state: CircuitState;
    consecutiveFailures: number;
    openUntil: number | null;
  } {
    const c = this.circuit(service);
    const state: CircuitState =
      c.openUntil === null ? "CLOSED" : this.now() < c.openUntil ? "OPEN" : "HALF_OPEN";
    return { state, consecutiveFailures: c.failures, openUntil: c.openUntil };
  }

  /**
   * Run `fn` through the service's circuit. Refused at once (ProviderUnavailableError, OUTAGE)
   * while open, or while another half-open trial is running; `onShortCircuit` is told.
   */
  async run<T>(
    service: ServiceName,
    fn: () => Promise<T>,
    onShortCircuit: () => Promise<void> | void,
  ): Promise<T> {
    const c = this.circuit(service);
    const { state } = this.state(service);
    if (state === "OPEN" || (state === "HALF_OPEN" && c.trialInFlight)) {
      await onShortCircuit();
      throw new ProviderUnavailableError(
        service,
        "OUTAGE",
        `${service} is not being called: its circuit opened after ${c.failures} failed calls in a row`,
      );
    }
    const trial = state === "HALF_OPEN";
    if (trial) c.trialInFlight = true;
    try {
      const value = await fn();
      c.failures = 0;
      c.openUntil = null;
      return value;
    } catch (err) {
      if (isProviderUnavailable(err)) {
        c.failures += 1;
        if (trial || c.failures >= this.threshold) c.openUntil = this.now() + this.openMs;
      }
      throw err;
    } finally {
      if (trial) c.trialInFlight = false;
    }
  }
}
