import {
  type DriftView,
  type HarnessRunView,
  type ModelRegistryView,
  type OverrideMonitorView,
  Role,
} from "@loan/core";
import { Body, Controller, Get, HttpCode, Post, Query } from "@nestjs/common";
import { ApiProperty, ApiPropertyOptional, ApiTags } from "@nestjs/swagger";
import { IsOptional, IsString, Length, Matches } from "class-validator";
import { CurrentUser, Roles } from "../auth/auth.decorators";
import type { SessionUser } from "../auth/session";
import { validation } from "../cases/domain-error";
import { GovernanceService } from "./governance.service";

const DATE = /^\d{4}-\d{2}-\d{2}$/;
/** The shape of a rule-set version ("RS-PL-5"); the service then checks it is one it knows. */
const VERSION = /^RS-[A-Z]+-\d+$/;

/** A harness run: the candidate rule set, the baseline (default live) and a period. */
export class HarnessRunDto {
  @ApiProperty({ description: "The rule set to try, e.g. RS-PL-5" })
  @IsString({ message: "Choose a rule set to try." })
  @Length(1, 20, { message: "Choose a rule set to try." })
  @Matches(VERSION, { message: "Choose a known rule set." })
  candidate!: string;

  @ApiPropertyOptional({ description: "The rule set to compare with; default the live one" })
  @IsOptional()
  @IsString({ message: "Choose a rule set to compare with." })
  @Length(1, 20, { message: "Choose a rule set to compare with." })
  @Matches(VERSION, { message: "Choose a known rule set." })
  baseline?: string;

  @ApiPropertyOptional({ description: "From this business date (YYYY-MM-DD); default 30 days" })
  @IsOptional()
  @Matches(DATE, { message: "Enter a date." })
  from?: string;

  @ApiPropertyOptional({ description: "To this business date, inclusive; default today" })
  @IsOptional()
  @Matches(DATE, { message: "Enter a date." })
  to?: string;
}

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

  /**
   * The rule-set test harness (PRD DEC-004): compares a candidate rule set with a baseline over
   * stored decisions. POST because each run is recorded in the audit log; it never publishes.
   */
  @Post("harness")
  @HttpCode(200)
  @Roles(...READERS)
  harness(@CurrentUser() user: SessionUser, @Body() body: HarnessRunDto): Promise<HarnessRunView> {
    return this.governance.harness(user, body);
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
