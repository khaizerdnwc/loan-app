import { type AmlEscalationView, EscalationOutcome, Role } from "@loan/core";
import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Query } from "@nestjs/common";
import { ApiProperty, ApiPropertyOptional, ApiTags } from "@nestjs/swagger";
import { IsIn, IsOptional, IsString, MaxLength } from "class-validator";
import { CurrentUser, Roles } from "../auth/auth.decorators";
import type { SessionUser } from "../auth/session";
import { ComplianceService } from "./compliance.service";

export class EscalationListQueryDto {
  @ApiPropertyOptional({ enum: ["open", "all"], description: "Default: open" })
  @IsOptional()
  @IsIn(["open", "all"])
  view?: "open" | "all";
}

export class CloseEscalationDto {
  @ApiProperty({ enum: Object.values(EscalationOutcome) })
  @IsIn(Object.values(EscalationOutcome))
  outcome!: EscalationOutcome;

  @ApiProperty({ description: "How the match was resolved", maxLength: 2000 })
  @IsString()
  @MaxLength(2000)
  notes!: string;
}

/**
 * AML escalations for Compliance (PRD CMP-005, F6). Compliance stays read-only on cases; this
 * is its own work: acknowledge an escalation, then close it with an outcome and notes.
 */
@ApiTags("compliance")
@Controller("compliance/escalations")
export class ComplianceController {
  constructor(private readonly compliance: ComplianceService) {}

  @Get()
  @Roles(Role.Compliance)
  list(
    @CurrentUser() user: SessionUser,
    @Query() q: EscalationListQueryDto,
  ): Promise<AmlEscalationView[]> {
    return this.compliance.list(user, (q.view ?? "open") === "open");
  }

  @Get(":id")
  @Roles(Role.Compliance)
  get(
    @CurrentUser() user: SessionUser,
    @Param("id", new ParseUUIDPipe()) id: string,
  ): Promise<AmlEscalationView> {
    return this.compliance.get(user, id);
  }

  @Post(":id/acknowledge")
  @Roles(Role.Compliance)
  @HttpCode(200)
  acknowledge(
    @CurrentUser() user: SessionUser,
    @Param("id", new ParseUUIDPipe()) id: string,
  ): Promise<AmlEscalationView> {
    return this.compliance.acknowledge(user, id);
  }

  @Post(":id/close")
  @Roles(Role.Compliance)
  @HttpCode(200)
  close(
    @CurrentUser() user: SessionUser,
    @Param("id", new ParseUUIDPipe()) id: string,
    @Body() body: CloseEscalationDto,
  ): Promise<AmlEscalationView> {
    return this.compliance.close(user, id, body);
  }
}
