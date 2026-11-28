import { INTAKE_SAMPLE_FILES, IntakeSource } from "@loan/core";
import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { Type } from "class-transformer";
import {
  IsDecimal,
  IsIn,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from "class-validator";

/**
 * Request bodies for email and file intake (PRD INT-010). The global ValidationPipe whitelists
 * and forbids unknown properties. Amounts are decimal strings; product limits are checked in
 * the service (product.ts).
 */
const DECIMAL = { decimal_digits: "0,2", force_decimal: false } as const;

/*
 * Officer wording for the new-customer fields. Each message starts with its field's name, which
 * the API's problem filter reads as the field; the dialog shows the words after it.
 */
const TENOR = "tenorMonths Enter the tenor as a whole number of months.";
const MONTHS = "employmentMonths Enter the months with the employer as a whole number, 0 to 600.";
const CUSTOMER_NUMBER =
  "customerNumber Enter the core customer number (up to 20 characters), or leave it empty.";

export class IntakeUploadDto {
  @ApiProperty({ enum: Object.values(IntakeSource) })
  @IsIn(Object.values(IntakeSource))
  source!: IntakeSource;

  @ApiPropertyOptional({
    enum: INTAKE_SAMPLE_FILES.map((f) => f.key),
    description: "Which synthetic file (simulated upload); the source's first file when left out",
  })
  @IsOptional()
  @IsIn(INTAKE_SAMPLE_FILES.map((f) => f.key))
  sampleFile?: string;
}

/** What the file does not carry, to capture a customer no record matches from the draft. */
export class NewCustomerFromDraftDto {
  @ApiProperty({ example: 24 })
  @IsInt({ message: MONTHS })
  @Min(0, { message: MONTHS })
  @Max(600, { message: MONTHS })
  employmentMonths!: number;

  @ApiProperty({ example: "5000.00" })
  @IsDecimal(DECIMAL, {
    message:
      "monthlyObligations Enter the monthly obligations in pesos, with at most 2 decimals (0 if none).",
  })
  monthlyObligations!: string;

  @ApiPropertyOptional({ example: "CIF-100245", description: "An existing WhiteBank customer" })
  @IsOptional()
  @IsString({ message: CUSTOMER_NUMBER })
  @MaxLength(20, { message: CUSTOMER_NUMBER })
  customerNumber?: string;
}

export class ConfirmIntakeDraftDto {
  @ApiProperty({ example: "120000.00" })
  @IsDecimal(DECIMAL, { message: "amount Enter the amount in pesos, with at most 2 decimals." })
  amount!: string;

  // The product's 6–36 months are checked in the service (termErrors), which names them.
  @ApiProperty({ example: 24 })
  @IsInt({ message: TENOR })
  @Min(1, { message: TENOR })
  @Max(600, { message: TENOR })
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

  @ApiPropertyOptional({
    type: NewCustomerFromDraftDto,
    description: "Capture the customer from the draft when no customer on record matches",
  })
  @IsOptional()
  @IsObject()
  @ValidateNested()
  @Type(() => NewCustomerFromDraftDto)
  newCustomer?: NewCustomerFromDraftDto;
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
