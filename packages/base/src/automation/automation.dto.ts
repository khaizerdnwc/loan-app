import {
  AUTOMATION_MODES,
  type AutomationChangeKind,
  type AutomationMode,
  EXTERNAL_ENGINE_ROLES,
  type ExternalEngineRole,
} from "@loan/core";
import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { IsIn, IsOptional, IsString, Length, MaxLength, ValidateIf } from "class-validator";

const CHANGE_KINDS: AutomationChangeKind[] = ["SET_MODE", "KILL_SWITCH_OFF", "SET_EXTERNAL_ENGINE"];

/**
 * Draft a change for a second administrator: a new mode, the kill switch off, or a new role
 * for the external decision engine (PRD DEC-008).
 */
export class AutomationChangeDto {
  @ApiProperty({ enum: CHANGE_KINDS })
  @IsIn(CHANGE_KINDS)
  kind!: AutomationChangeKind;

  @ApiPropertyOptional({ enum: AUTOMATION_MODES, description: "Required for SET_MODE." })
  @ValidateIf((o: AutomationChangeDto) => o.kind === "SET_MODE" || o.mode !== undefined)
  @IsIn(AUTOMATION_MODES)
  mode?: AutomationMode;

  @ApiPropertyOptional({
    enum: EXTERNAL_ENGINE_ROLES,
    description: "Required for SET_EXTERNAL_ENGINE.",
  })
  @ValidateIf(
    (o: AutomationChangeDto) => o.kind === "SET_EXTERNAL_ENGINE" || o.externalEngine !== undefined,
  )
  @IsIn(EXTERNAL_ENGINE_ROLES)
  externalEngine?: ExternalEngineRole;

  @ApiProperty({ maxLength: 500 })
  @IsString()
  @Length(1, 500)
  reason!: string;
}

export class KillSwitchDto {
  @ApiProperty({ maxLength: 500 })
  @IsString()
  @Length(1, 500)
  reason!: string;
}

export class DecideAutomationChangeDto {
  @ApiPropertyOptional({ maxLength: 500 })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}
