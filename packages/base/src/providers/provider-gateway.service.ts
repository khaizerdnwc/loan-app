import { randomInt } from "node:crypto";
import {
  type ApplicantIdentity,
  type BureauReport,
  CREDIT_BUREAU,
  type CreditBureau,
  FRAUD_CHECK,
  type FraudAssessment,
  type FraudCheck,
  KYC_AML,
  type KycAml,
  type ScreeningResult,
} from "@loan/contracts";
import {
  type DecisionLatencyView,
  Money,
  type ProviderMode,
  type ProviderUsageView,
  ServiceName,
} from "@loan/core";
import { Inject, Injectable } from "@nestjs/common";
import { LENDING_OPTIONS, type LendingModuleOptions } from "../lending.options";
import type { ProviderCallOutcome } from "./providers.entities";
import { ProvidersRepository } from "./providers.repository";
import {
  CircuitBreaker,
  DEFAULT_RESILIENCE,
  type ResilienceOptions,
  withRetry,
} from "./resilience";

/** The decision's providers: the ones this gateway calls, retries and counts. */
const DECISION_SERVICES = [ServiceName.CreditBureau, ServiceName.KycAml, ServiceName.Fraud];

/**
 * Simulated price per successful call (PRD IH-006). Synthetic figures for the demo, not a
 * provider's tariff (docs/ASSUMPTIONS.md "Provider resilience and cost").
 */
export const PRICE: Partial<Record<ServiceName, Money>> = {
  CREDIT_BUREAU: Money.of("25.00"),
  KYC_AML: Money.of("10.00"),
  FRAUD: Money.of("5.00"),
};

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** A bureau report as the decision uses it, with where it came from. */
export type GatheredReport = BureauReport & { fromCache: boolean };

/**
 * The decision's provider calls (bureau, KYC/AML, fraud) behind one policy (PRD IH-003,
 * IH-005, IH-006): a cached bureau report is reused for the reuse window; otherwise each call
 * runs through its service's circuit breaker and is retried with backoff; every attempt is
 * counted with its simulated cost. A call that still fails throws ProviderUnavailableError, so
 * the decision refers as before (NFR-005). Booking calls are not routed here: they already
 * retry by hand with the same idempotency key (ADR 0020).
 */
@Injectable()
export class ProviderGateway {
  private readonly options: ResilienceOptions;
  private readonly breaker: CircuitBreaker;

  constructor(
    @Inject(CREDIT_BUREAU) private readonly bureau: CreditBureau,
    @Inject(KYC_AML) private readonly kycAml: KycAml,
    @Inject(FRAUD_CHECK) private readonly fraud: FraudCheck,
    private readonly repo: ProvidersRepository,
    @Inject(LENDING_OPTIONS) lending: LendingModuleOptions,
  ) {
    // A decision record holds one provider mode; mixing a real and a simulated provider
    // would make it ambiguous, so that wiring is refused at boot.
    if (bureau.mode !== kycAml.mode || bureau.mode !== fraud.mode) {
      throw new Error(
        `Credit bureau (${bureau.mode}), KYC/AML (${kycAml.mode}) and fraud check (${fraud.mode}) must run in the same provider mode.`,
      );
    }
    this.options = { ...DEFAULT_RESILIENCE, ...lending.resilience };
    this.breaker = new CircuitBreaker(
      this.options.circuitThreshold,
      this.options.circuitOpenMs,
      Date.now,
    );
  }

  /** The one provider mode of every decision input (checked at boot). */
  get mode(): ProviderMode {
    return this.bureau.mode;
  }

  async pullBureau(subject: ApplicantIdentity, caseId: string | null): Promise<GatheredReport> {
    const since = new Date(Date.now() - this.options.bureauCacheDays * 86_400_000);
    const cached = await this.repo.cachedReport(subject.applicantId, this.mode, since);
    if (cached) {
      await this.count(ServiceName.CreditBureau, "PULL_REPORT", "CACHE_HIT", null, 0, 0, caseId);
      return {
        ...(cached.report as unknown as BureauReport),
        retrievedAt: cached.retrievedAt.toISOString(),
        fromCache: true,
      };
    }
    const report = await this.call(ServiceName.CreditBureau, "PULL_REPORT", caseId, () =>
      this.bureau.pull(subject),
    );
    await this.repo.cacheReport({
      applicantId: subject.applicantId,
      mode: report.mode,
      retrievedAt: new Date(report.retrievedAt),
      report: {
        provider: report.provider,
        mode: report.mode,
        fileDepth: report.fileDepth,
        bureauScore: report.bureauScore,
        tradeLines: report.tradeLines,
        utilisationPct: report.utilisationPct,
        delinquencies12m: report.delinquencies12m,
        existingDefault: report.existingDefault,
        monthsOnFile: report.monthsOnFile,
      },
    });
    return { ...report, fromCache: false };
  }

  screen(subject: ApplicantIdentity, caseId: string | null): Promise<ScreeningResult> {
    return this.call(ServiceName.KycAml, "SCREEN", caseId, () => this.kycAml.screen(subject));
  }

  assessFraud(subject: ApplicantIdentity, caseId: string | null): Promise<FraudAssessment> {
    return this.call(ServiceName.Fraud, "ASSESS", caseId, () => this.fraud.assess(subject));
  }

  /** Calls, failures, cache hits and simulated cost per service since a time, with circuits. */
  async usage(since: Date): Promise<ProviderUsageView> {
    const rows = await this.repo.usage(since);
    let total = Money.zero();
    const services = DECISION_SERVICES.map((service) => {
      const of = (outcome: ProviderCallOutcome) =>
        rows.find((r) => r.service === service && r.outcome === outcome);
      const cost = Money.sum(
        rows.filter((r) => r.service === service).map((r) => Money.of(r.cost)),
      );
      total = total.plus(cost);
      const circuit = this.breaker.state(service);
      const ok = of("OK")?.n ?? 0;
      const failed = of("FAILED")?.n ?? 0;
      return {
        service,
        attempts: ok + failed,
        ok,
        failed,
        shortCircuited: of("SHORT_CIRCUITED")?.n ?? 0,
        cacheHits: of("CACHE_HIT")?.n ?? 0,
        cost: cost.toString(),
        circuit: {
          state: circuit.state,
          consecutiveFailures: circuit.consecutiveFailures,
          openUntil:
            circuit.state === "CLOSED" || circuit.openUntil === null
              ? null
              : new Date(circuit.openUntil).toISOString(),
        },
      };
    });
    return { since: since.toISOString(), services, totalCost: total.toString() };
  }

  async latency(since: Date): Promise<DecisionLatencyView> {
    const l = await this.repo.latency(since);
    return {
      since: since.toISOString(),
      decisions: l.n,
      p50Ms: l.p50,
      p95Ms: l.p95,
      maxMs: l.max,
      targetP95Ms: 60_000,
    };
  }

  private call<T>(
    service: ServiceName,
    operation: string,
    caseId: string | null,
    fn: () => Promise<T>,
  ): Promise<T> {
    return this.breaker.run(
      service,
      () =>
        withRetry(fn, {
          attempts: this.options.retryAttempts,
          baseMs: this.options.retryBaseMs,
          sleep,
          // Jitter from a CSPRNG (house/no-math-random-in-server); spreads retries apart.
          jitter: (base) => (base > 0 ? randomInt(0, base) : 0),
          now: Date.now,
          onAttempt: (a) =>
            this.count(
              service,
              operation,
              a.ok ? "OK" : "FAILED",
              a.failure,
              a.attempt,
              a.durationMs,
              caseId,
            ),
        }),
      () => this.count(service, operation, "SHORT_CIRCUITED", null, 0, 0, caseId),
    );
  }

  private count(
    service: ServiceName,
    operation: string,
    outcome: ProviderCallOutcome,
    failure: string | null,
    attempt: number,
    durationMs: number,
    caseId: string | null,
  ): Promise<void> {
    return this.repo.recordCall({
      service,
      operation,
      outcome,
      failure,
      attempt,
      durationMs,
      cost: outcome === "OK" ? (PRICE[service] ?? Money.zero()) : Money.zero(),
      caseId,
    });
  }
}
