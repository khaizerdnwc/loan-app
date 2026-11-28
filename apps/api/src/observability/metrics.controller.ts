import { ProviderGateway, Public } from "@loan/base";
import { ProblemCode } from "@loan/core";
import { Controller, Get, Header, Inject, NotFoundException } from "@nestjs/common";
import { ApiExcludeController } from "@nestjs/swagger";
import { HttpMetrics, labels, METRICS_ENABLED } from "./http-metrics";

/** When this process started: the window for the provider counts below. */
const STARTED = new Date();

/**
 * GET /metrics, the Prometheus text exposition format, for a scraper on the API's private
 * network. Off unless METRICS_ENABLED=true (then it answers 404 like any unknown route), never
 * forwarded by the backoffice proxy, and carrying no applicant data: request counts and
 * durations by route pattern, provider attempts by outcome, and each provider's circuit state.
 */
@ApiExcludeController()
@Controller("metrics")
export class MetricsController {
  constructor(
    private readonly http: HttpMetrics,
    private readonly providers: ProviderGateway,
    @Inject(METRICS_ENABLED) private readonly enabled: boolean,
  ) {}

  @Get()
  @Public()
  @Header("Content-Type", "text/plain; version=0.0.4; charset=utf-8")
  async metrics(): Promise<string> {
    if (!this.enabled) {
      throw new NotFoundException({ code: ProblemCode.NotFound, detail: "Not found." });
    }
    const usage = await this.providers.usage(STARTED);
    const lines = [
      "# HELP loan_provider_attempts Provider calls since this process started, by outcome (all replicas write the same counter table).",
      "# TYPE loan_provider_attempts gauge",
    ];
    for (const s of usage.services) {
      for (const [outcome, n] of [
        ["ok", s.ok],
        ["failed", s.failed],
        ["short_circuited", s.shortCircuited],
        ["cache_hit", s.cacheHits],
      ] as const) {
        lines.push(`loan_provider_attempts${labels({ service: s.service, outcome })} ${n}`);
      }
    }
    lines.push(
      "# HELP loan_provider_circuit_open Whether a provider's circuit is open (1) or half-open (0.5), else 0, in this process.",
      "# TYPE loan_provider_circuit_open gauge",
    );
    for (const s of usage.services) {
      const value = s.circuit.state === "OPEN" ? 1 : s.circuit.state === "HALF_OPEN" ? 0.5 : 0;
      lines.push(`loan_provider_circuit_open${labels({ service: s.service })} ${value}`);
    }
    return `${this.http.render()}${lines.join("\n")}\n`;
  }
}
