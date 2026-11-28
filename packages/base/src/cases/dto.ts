import {
  CoreBankingSimulationMode,
  DeclineReason,
  DocumentType,
  OverrideReason,
  Priority,
  Recommendation,
  WithdrawReason,
} from "@loan/core";
import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { Type } from "class-transformer";
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
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

/** Officer wording; the leading token is the field, as the problem filter reads it. */
const EMPLOYMENT_MONTHS =
  "employmentMonths Enter the months with the employer as a whole number, 0 to 600.";

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
  @IsDecimal(DECIMAL, { message: "amount Enter the amount in pesos, with at most 2 decimals." })
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
  @IsDecimal(DECIMAL, { message: "amount Enter the amount in pesos, with at most 2 decimals." })
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
  @IsDecimal(DECIMAL, { message: "amount Enter the amount in pesos, with at most 2 decimals." })
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

/** A new applicant captured by the loan officer (PRD INT-005); see NewApplicantRequest. */
export class NewApplicantDto {
  @ApiPropertyOptional({ example: "CIF-100245", description: "Existing customer: from core" })
  @IsOptional()
  @IsString()
  @MaxLength(20)
  customerNumber?: string;

  @ApiProperty()
  @IsString()
  @MaxLength(120)
  fullName!: string;

  @ApiProperty({ example: "1992-04-30" })
  @IsString()
  @MaxLength(10)
  birthDate!: string;

  @ApiProperty({ example: "1234" })
  @IsString()
  @MaxLength(4)
  governmentIdLast4!: string;

  @ApiProperty()
  @IsString()
  @MaxLength(160)
  employer!: string;

  @ApiProperty({ example: 24 })
  @IsInt({ message: EMPLOYMENT_MONTHS })
  @Min(0, { message: EMPLOYMENT_MONTHS })
  @Max(600, { message: EMPLOYMENT_MONTHS })
  employmentMonths!: number;

  @ApiProperty({ example: "45000.00" })
  @IsDecimal(DECIMAL, {
    message: "monthlyIncome Enter the monthly income in pesos, with at most 2 decimals.",
  })
  monthlyIncome!: string;

  @ApiProperty({ example: "5000.00" })
  @IsDecimal(DECIMAL, {
    message:
      "monthlyObligations Enter the monthly obligations in pesos, with at most 2 decimals (0 if none).",
  })
  monthlyObligations!: string;
}

export class ReassignDto {
  @ApiProperty({ example: "STF-JOY" })
  @IsString()
  @Length(1, 40)
  ownerId!: string;

  @ApiProperty()
  @IsString()
  @MaxLength(500)
  reason!: string;
}

export class SetPriorityDto {
  @ApiProperty({ enum: Object.values(Priority) })
  @IsIn(Object.values(Priority))
  priority!: Priority;
}

export class InfoRequestDto {
  @ApiProperty({ enum: Object.values(DocumentType), isArray: true })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(3)
  @IsIn(Object.values(DocumentType), { each: true })
  documents!: DocumentType[];

  @ApiProperty({ example: "Please upload your last 3 months of bank statements." })
  @IsString()
  @MaxLength(1000)
  message!: string;

  @ApiProperty({ enum: [3, 5] })
  @IsIn([3, 5])
  dueInDays!: 3 | 5;
}

export class DocumentReviewDto {
  @ApiProperty({ enum: ["VERIFIED", "REJECTED"] })
  @IsIn(["VERIFIED", "REJECTED"])
  decision!: "VERIFIED" | "REJECTED";

  @ApiPropertyOptional({ description: "Required when rejecting" })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  reason?: string;
}

/** `GET /products/PL/quote`: the requested terms to quote an indicative repayment for. */
export class IndicativeQuoteQueryDto {
  @ApiProperty({ example: "150000.00" })
  @IsDecimal(DECIMAL, { message: "amount Enter the amount in pesos, with at most 2 decimals." })
  amount!: string;

  @ApiProperty({ example: 24 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(600)
  tenorMonths!: number;
}

export class SetSimulationModeDto {
  @ApiProperty({ enum: Object.values(CoreBankingSimulationMode) })
  @IsIn(Object.values(CoreBankingSimulationMode))
  mode!: CoreBankingSimulationMode;
}
