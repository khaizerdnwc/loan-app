import { IntakeSource } from "@loan/core";
import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import {
  IsDecimal,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
} from "class-validator";

/**
 * Request bodies for email and file intake (PRD INT-010). The global ValidationPipe whitelists
 * and forbids unknown properties. Amounts are decimal strings; product limits are checked in
 * the service (product.ts).
 */
const DECIMAL = { decimal_digits: "0,2", force_decimal: false } as const;

export class IntakeUploadDto {
  @ApiProperty({ enum: Object.values(IntakeSource) })
  @IsIn(Object.values(IntakeSource))
  source!: IntakeSource;
}

export class ConfirmIntakeDraftDto {
  @ApiProperty({ example: "120000.00" })
  @IsDecimal(DECIMAL, { message: "amount must be a decimal string with at most 2 decimals" })
  amount!: string;

  @ApiProperty({ example: 24 })
  @IsInt()
  @Min(1)
  @Max(600)
  tenorMonths!: number;

  @ApiProperty({ example: "Home renovation" })
  @IsString()
  @MaxLength(120)
  purpose!: string;

  @ApiPropertyOptional({
    example: "6619",
    description: "Last 4 digits of the government ID, when OCR could not read it",
  })
  @IsOptional()
  @Matches(/^\d{4}$/, {
    message: "governmentIdLast4 must be the last 4 digits of the government ID",
  })
  governmentIdLast4?: string;
}

export class IntakeListQueryDto {
  @ApiPropertyOptional({ enum: ["pending", "all"], description: "Default: pending" })
  @IsOptional()
  @IsIn(["pending", "all"])
  view?: "pending" | "all";
}

export class DiscardIntakeDraftDto {
  @ApiProperty({ example: "Applicant already has a loan in progress at the branch" })
  @IsString()
  @MaxLength(2000)
  reason!: string;
}
