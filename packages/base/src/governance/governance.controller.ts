import { type DriftView, type ModelRegistryView, type OverrideMonitorView, Role } from "@loan/core";
import { Controller, Get, Query } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { Roles } from "../auth/auth.decorators";
import { validation } from "../cases/domain-error";
import { GovernanceService } from "./governance.service";

/** Model risk is read by administrators (the credit risk manager) and compliance. */
const READERS = [Role.Admin, Role.Compliance];

/**
 * Model governance (PRD AIS-008, AIS-009, AIS-011, AIS-012, CMP-008): the registry, override
 * monitoring and drift. Read-only.
 */
@ApiTags("models")
@Controller("models")
export class GovernanceController {
  constructor(private readonly governance: GovernanceService) {}

  @Get()
  @Roles(...READERS)
  registry(): Promise<ModelRegistryView> {
    return this.governance.registry();
  }

  @Get("overrides")
  @Roles(...READERS)
  overrides(@Query("days") days?: string): Promise<OverrideMonitorView> {
    const n = parseDays(days, 30, "days");
    return this.governance.overrides(new Date(Date.now() - n * 86_400_000));
  }

  @Get("drift")
  @Roles(...READERS)
  drift(
    @Query("recentDays") recentDays?: string,
    @Query("baselineDays") baselineDays?: string,
  ): Promise<DriftView> {
    return this.governance.drift(
      parseDays(recentDays, 30, "recentDays"),
      parseDays(baselineDays, 90, "baselineDays"),
    );
  }
}

/** A window in whole days, 1 to 366; `fallback` when absent. */
function parseDays(raw: string | undefined, fallback: number, field: string): number {
  const n = raw === undefined || raw === "" ? fallback : Number(raw);
  if (!Number.isInteger(n) || n < 1 || n > 366) {
    throw validation("Choose a window of 1 to 366 days.", [
      { field, message: "Enter a whole number of days from 1 to 366." },
    ]);
  }
  return n;
}
