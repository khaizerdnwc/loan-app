import { AUTOMATION_MODES, type AutomationChangeKind, type AutomationMode } from "@loan/core";
import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { IsIn, IsOptional, IsString, Length, MaxLength, ValidateIf } from "class-validator";

const CHANGE_KINDS: AutomationChangeKind[] = ["SET_MODE", "KILL_SWITCH_OFF"];

/** Draft a change for a second administrator: a new mode, or the kill switch off. */
export class AutomationChangeDto {
  @ApiProperty({ enum: CHANGE_KINDS })
  @IsIn(CHANGE_KINDS)
  kind!: AutomationChangeKind;

  @ApiPropertyOptional({ enum: AUTOMATION_MODES, description: "Required for SET_MODE." })
  @ValidateIf((o: AutomationChangeDto) => o.kind === "SET_MODE" || o.mode !== undefined)
  @IsIn(AUTOMATION_MODES)
  mode?: AutomationMode;

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
