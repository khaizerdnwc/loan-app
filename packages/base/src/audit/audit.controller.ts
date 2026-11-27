import { type AuditChainVerification, type AuditLogPage, Role } from "@loan/core";
import { Controller, Get, Query } from "@nestjs/common";
import { ApiPropertyOptional, ApiTags } from "@nestjs/swagger";
import { Type } from "class-transformer";
import { IsInt, IsOptional, IsString, Matches, Max, MaxLength, Min } from "class-validator";
import { CurrentUser, Roles } from "../auth/auth.decorators";
import type { SessionUser } from "../auth/session";
import { forbiddenRole, validation } from "../cases/domain-error";
import { AuditService } from "./audit.service";

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const PH_OFFSET_MS = 8 * 3_600_000;

export class AuditQueryDto {
  @ApiPropertyOptional({ description: "A staff id, or part of a name" })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  actor?: string;

  @ApiPropertyOptional({ description: "An action code, e.g. SIGN_IN_FAILED" })
  @IsOptional()
  @Matches(/^[A-Z_]{1,60}$/, { message: "action must be an action code" })
  action?: string;

  @ApiPropertyOptional({ description: "From this business date (YYYY-MM-DD, Philippine time)" })
  @IsOptional()
  @Matches(DATE, { message: "from must be a date (YYYY-MM-DD)" })
  from?: string;

  @ApiPropertyOptional({ description: "To this business date, inclusive" })
  @IsOptional()
  @Matches(DATE, { message: "to must be a date (YYYY-MM-DD)" })
  to?: string;

  @ApiPropertyOptional({ description: "A case reference, e.g. APP-1001" })
  @IsOptional()
  @Matches(/^[A-Za-z]{2,5}-\d{1,10}$/, { message: "case must be a case reference" })
  case?: string;

  @ApiPropertyOptional({ description: "Entries older than this sequence number (paging)" })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  before?: number;

  @ApiPropertyOptional({ description: "Page size, 1–200 (default 50)" })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  limit?: number;
}

/**
 * The audit log (PRD PLT-004, CMP-010) for Compliance and the administrator. Read-only:
 * entries are written by the actions they record, never through this controller.
 */
@ApiTags("audit")
@Controller("audit")
export class AuditController {
  constructor(private readonly audit: AuditService) {}

  @Get("events")
  @Roles(Role.Compliance, Role.Admin)
  search(@CurrentUser() user: SessionUser, @Query() q: AuditQueryDto): Promise<AuditLogPage> {
    // The administrator sees case entries without the case: a case filter would reveal it.
    if (q.case && user.role !== Role.Compliance) {
      throw forbiddenRole("Only Compliance can search the audit log by case.");
    }
    const from = q.from ? dayStart(q.from, "from") : undefined;
    const to = q.to ? new Date(dayStart(q.to, "to").getTime() + 86_400_000 - 1) : undefined;
    if (from && to && from > to) {
      throw validation("The date range ends before it starts.", [
        { field: "to", message: "Choose a date on or after the start date." },
      ]);
    }
    return this.audit.search(user, {
      actor: q.actor?.trim() || undefined,
      action: q.action,
      from,
      to,
      caseReference: q.case,
      before: q.before,
      limit: q.limit ?? 50,
    });
  }

  @Get("actions")
  @Roles(Role.Compliance, Role.Admin)
  actions(): Promise<string[]> {
    return this.audit.actions();
  }

  @Get("verify")
  @Roles(Role.Compliance, Role.Admin)
  verify(): Promise<AuditChainVerification> {
    return this.audit.verify();
  }
}

/** Midnight at the start of a Philippine business date (UTC+8); refuses a date like 2026-02-31. */
function dayStart(date: string, field: string): Date {
  const d = new Date(`${date}T00:00:00.000+08:00`);
  const roundTrip = Number.isNaN(d.getTime())
    ? null
    : new Date(d.getTime() + PH_OFFSET_MS).toISOString().slice(0, 10);
  if (roundTrip !== date) {
    throw validation("Check the dates.", [{ field, message: "Enter a real date." }]);
  }
  return d;
}
