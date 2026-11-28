import { type DecisionMixReport, type OriginationFunnelReport, Role } from "@loan/core";
import { Controller, Get, Query } from "@nestjs/common";
import { ApiPropertyOptional, ApiTags } from "@nestjs/swagger";
import { IsOptional, Matches } from "class-validator";
import { Roles } from "../auth/auth.decorators";
import { ReportsService } from "./reports.service";

const DATE = /^\d{4}-\d{2}-\d{2}$/;

export class ReportPeriodQueryDto {
  @ApiPropertyOptional({ description: "From this business date (YYYY-MM-DD); default 30 days" })
  @IsOptional()
  @Matches(DATE, { message: "from must be a date (YYYY-MM-DD)" })
  from?: string;

  @ApiPropertyOptional({ description: "To this business date, inclusive; default today" })
  @IsOptional()
  @Matches(DATE, { message: "to must be a date (YYYY-MM-DD)" })
  to?: string;
}

/**
 * Counts only (no applicant data or case reference), so the roles that read decisions see
 * them, and the administrator too, as in the prototype's Reports group.
 */
export const REPORT_READERS = [Role.LoanOfficer, Role.Approver, Role.Compliance, Role.Admin];

/**
 * The decision-mix and origination-funnel reports (PRD RPT-003, RPT-001). Read-only. The
 * turnaround report (RPT-002) shares the /reports path but lives in sla/ (TurnaroundController),
 * so reports/ never imports sla/.
 */
@ApiTags("reports")
@Controller("reports")
export class ReportsController {
  constructor(private readonly reports: ReportsService) {}

  @Get("decision-mix")
  @Roles(...REPORT_READERS)
  decisionMix(@Query() q: ReportPeriodQueryDto): Promise<DecisionMixReport> {
    return this.reports.decisionMix(q.from, q.to);
  }

  @Get("funnel")
  @Roles(...REPORT_READERS)
  funnel(@Query() q: ReportPeriodQueryDto): Promise<OriginationFunnelReport> {
    return this.reports.funnel(q.from, q.to);
  }
}
