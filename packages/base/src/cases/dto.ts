import {
  CoreBankingSimulationMode,
  DeclineReason,
  OverrideReason,
  Recommendation,
  WithdrawReason,
} from "@loan/core";
import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { Type } from "class-transformer";
import {
  IsBoolean,
  IsDecimal,
  IsIn,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  Length,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from "class-validator";

/**
 * Request bodies. The global ValidationPipe whitelists and forbids unknown properties, so
 * nothing a body does not declare reaches a service. Amounts are decimal strings with at
 * most two places; product limits are checked again in the service (one source of truth
 * for the numbers: product.ts).
 */
const DECIMAL = { decimal_digits: "0,2", force_decimal: false } as const;

export class ConsentDto {
  @ApiProperty({ description: "Consent to a credit bureau check" })
  @IsBoolean()
  creditBureauCheck!: boolean;

  @ApiProperty({ description: "Consent to processing under the Data Privacy Act" })
  @IsBoolean()
  dataProcessing!: boolean;

  @ApiProperty({ example: "1.0", description: "Terms and conditions version agreed to" })
  @IsString()
  @Length(1, 20)
  termsVersion!: string;
}

export class CreateCaseDto {
  @ApiProperty({ example: "APL-MARIA" })
  @IsString()
  @Length(1, 40)
  applicantId!: string;

  @ApiProperty({ example: "150000.00" })
  @IsDecimal(DECIMAL, { message: "amount must be a decimal string with at most 2 decimals" })
  amount!: string;

  @ApiProperty({ example: 24 })
  @IsInt()
  @Min(1)
  @Max(600)
  tenorMonths!: number;

  @ApiProperty({ example: "Home improvement" })
  @IsString()
  @MaxLength(120)
  purpose!: string;

  @ApiProperty({ description: "Submit for decision now (true) or save a draft (false)" })
  @IsBoolean()
  submit!: boolean;

  @ApiPropertyOptional({ type: ConsentDto, description: "Required before submitting" })
  @IsOptional()
  @IsObject()
  @ValidateNested()
  @Type(() => ConsentDto)
  consent?: ConsentDto;
}

export class UpdateDraftDto {
  @ApiPropertyOptional({ type: ConsentDto })
  @IsOptional()
  @IsObject()
  @ValidateNested()
  @Type(() => ConsentDto)
  consent?: ConsentDto;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDecimal(DECIMAL, { message: "amount must be a decimal string with at most 2 decimals" })
  amount?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(600)
  tenorMonths?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(120)
  purpose?: string;
}

export class RecommendDto {
  @ApiProperty({ enum: Object.values(Recommendation) })
  @IsIn(Object.values(Recommendation))
  type!: Recommendation;

  @ApiPropertyOptional({ example: "120000.00" })
  @IsOptional()
  @IsDecimal(DECIMAL, { message: "amount must be a decimal string with at most 2 decimals" })
  amount?: string;

  @ApiPropertyOptional({ example: 36 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(600)
  tenorMonths?: number;

  @ApiPropertyOptional({ enum: Object.values(OverrideReason) })
  @IsOptional()
  @IsIn(Object.values(OverrideReason))
  overrideReason?: OverrideReason;

  @ApiProperty()
  @IsString()
  @MaxLength(2000)
  rationale!: string;
}

export class DeclineDto {
  @ApiProperty({ enum: Object.values(DeclineReason) })
  @IsIn(Object.values(DeclineReason))
  reasonCode!: DeclineReason;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  note?: string;
}

export class WithdrawDto {
  @ApiProperty({ enum: Object.values(WithdrawReason) })
  @IsIn(Object.values(WithdrawReason))
  reasonCode!: WithdrawReason;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  note?: string;
}

export class SetSimulationModeDto {
  @ApiProperty({ enum: Object.values(CoreBankingSimulationMode) })
  @IsIn(Object.values(CoreBankingSimulationMode))
  mode!: CoreBankingSimulationMode;
}
