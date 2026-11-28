import { type DecisionLatencyView, type ProviderUsageView, Role } from "@loan/core";
import { Controller, Get, Query } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { Roles } from "../auth/auth.decorators";
import { validation } from "../cases/domain-error";
import { ProviderGateway } from "./provider-gateway.service";

const READERS = [Role.Admin, Role.Compliance];

/** Days back a window may reach. */
const MAX_DAYS = 366;

/**
 * Provider calls, failures, cache hits, circuit states and simulated cost (PRD IH-003, IH-005,
 * IH-006), and decision latency (NFR-003, AIS-001). Read-only, for administrators and
 * compliance.
 */
@ApiTags("providers")
@Controller()
export class ProvidersController {
  constructor(private readonly gateway: ProviderGateway) {}

  @Get("providers/usage")
  @Roles(...READERS)
  usage(@Query("days") days?: string): Promise<ProviderUsageView> {
    return this.gateway.usage(since(days));
  }

  @Get("decisions/latency")
  @Roles(...READERS)
  latency(@Query("days") days?: string): Promise<DecisionLatencyView> {
    return this.gateway.latency(since(days));
  }
}

/** The window's start: `days` back from now (30 by default). */
function since(days: string | undefined): Date {
  const n = days === undefined || days === "" ? 30 : Number(days);
  if (!Number.isInteger(n) || n < 1 || n > MAX_DAYS) {
    throw validation("Choose a window of 1 to 366 days.", [
      { field: "days", message: "Enter a whole number of days from 1 to 366." },
    ]);
  }
  return new Date(Date.now() - n * 86_400_000);
}
