import { type CaseSlaView, Role, type SlaView, type TurnaroundReport } from "@loan/core";
import { Controller, Get, Param, ParseUUIDPipe, Query } from "@nestjs/common";
import { ApiPropertyOptional, ApiTags } from "@nestjs/swagger";
import { IsIn, IsOptional } from "class-validator";
import { CurrentUser, Roles } from "../auth/auth.decorators";
import type { SessionUser } from "../auth/session";
import { REPORT_READERS, ReportPeriodQueryDto } from "../reports/reports.controller";
import { SlaService } from "./sla.service";

/** The roles that read cases (cases.controller.ts); each sees clocks for its own cases only. */
const CASE_READERS = [
  Role.LoanOfficer,
  Role.Approver,
  Role.LoanOperations,
  Role.LoanOperationsSupervisor,
  Role.Compliance,
];

export class SlaListQueryDto {
  @ApiPropertyOptional({ enum: ["queue", "all"], description: "Default: queue" })
  @IsOptional()
  @IsIn(["queue", "all"])
  view?: "queue" | "all";
}

/** Stage SLAs (PRD WF-003): read-only clocks beside the case lists and the case page. */
@ApiTags("sla")
@Controller("sla")
export class SlaController {
  constructor(private readonly sla: SlaService) {}

  /** Clocks for the cases in the caller's queue (or all cases it can see). */
  @Get("cases")
  @Roles(...CASE_READERS)
  list(@CurrentUser() user: SessionUser, @Query() q: SlaListQueryDto): Promise<SlaView[]> {
    return this.sla.list(user, q.view ?? "queue");
  }

  /** One case's clock (`sla` is null when its stage has none). */
  @Get("cases/:id")
  @Roles(...CASE_READERS)
  one(
    @CurrentUser() user: SessionUser,
    @Param("id", new ParseUUIDPipe()) id: string,
  ): Promise<CaseSlaView> {
    return this.sla.forCase(user, id);
  }
}

/**
 * RPT-002 at /reports/turnaround, beside the other reports, but declared here: sla/ may use
 * reports/ (its period rules and readers), never the other way round.
 */
@ApiTags("reports")
@Controller("reports")
export class TurnaroundController {
  constructor(private readonly sla: SlaService) {}

  /** Business time per stage, and the open cases by SLA state. */
  @Get("turnaround")
  @Roles(...REPORT_READERS)
  turnaround(@Query() q: ReportPeriodQueryDto): Promise<TurnaroundReport> {
    return this.sla.turnaround(q.from, q.to);
  }
}
