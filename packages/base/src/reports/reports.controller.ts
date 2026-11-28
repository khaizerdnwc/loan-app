import { type DecisionMixReport, type OriginationFunnelReport, Role } from "@loan/core";
import { Controller, Get, Header, Query, type StreamableFile } from "@nestjs/common";
import { ApiPropertyOptional, ApiTags } from "@nestjs/swagger";
import { IsOptional, Matches } from "class-validator";
import { CurrentUser, Roles } from "../auth/auth.decorators";
import type { SessionUser } from "../auth/session";
import { decisionMixRows, funnelRows } from "./csv";
import { ReportExportService } from "./report-export.service";
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
 * The decision-mix and origination-funnel reports (PRD RPT-003, RPT-001), as JSON for the
 * screens and as CSV downloads (RPT-006), each download audited. Read-only otherwise. The
 * turnaround report (RPT-002) shares the /reports path but lives in sla/ (TurnaroundController),
 * so reports/ never imports sla/.
 */
@ApiTags("reports")
@Controller("reports")
export class ReportsController {
  constructor(
    private readonly reports: ReportsService,
    private readonly exports: ReportExportService,
  ) {}

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

  /** The decision-mix report as a CSV file (RPT-006); the download is audited. */
  @Get("decision-mix.csv")
  @Roles(...REPORT_READERS)
  @Header("Cache-Control", "no-store")
  async decisionMixCsv(
    @CurrentUser() user: SessionUser,
    @Query() q: ReportPeriodQueryDto,
  ): Promise<StreamableFile> {
    const r = await this.reports.decisionMix(q.from, q.to);
    return this.exports.download(user, "DECISION_MIX", r.period, decisionMixRows(r));
  }

  /** The origination funnel as a CSV file (RPT-006); the download is audited. */
  @Get("funnel.csv")
  @Roles(...REPORT_READERS)
  @Header("Cache-Control", "no-store")
  async funnelCsv(
    @CurrentUser() user: SessionUser,
    @Query() q: ReportPeriodQueryDto,
  ): Promise<StreamableFile> {
    const r = await this.reports.funnel(q.from, q.to);
    return this.exports.download(user, "FUNNEL", r.period, funnelRows(r));
  }
}
