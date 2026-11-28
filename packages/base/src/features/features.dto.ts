import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { IsBoolean, IsOptional, IsString, Length, MaxLength } from "class-validator";

/** Draft switching a module on or off, for a second administrator to approve. */
export class FeatureFlagChangeDto {
  @ApiProperty({ description: "What the flag becomes on approval." })
  @IsBoolean()
  enabled!: boolean;

  @ApiProperty({ maxLength: 500 })
  @IsString()
  @Length(1, 500)
  reason!: string;
}

export class DecideFeatureFlagChangeDto {
  @ApiPropertyOptional({ maxLength: 500 })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}
