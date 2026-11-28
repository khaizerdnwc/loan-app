import { ApiProperty } from "@nestjs/swagger";
import { IsDecimal, IsInt, Max, Min } from "class-validator";

const DECIMAL = { decimal_digits: "0,2", force_decimal: false } as const;

/** Figures the applicant states; no identity, so nothing personal is sent or kept. */
export class EligibilityPreCheckDto {
  @ApiProperty({ example: "150000.00" })
  @IsDecimal(DECIMAL, { message: "amount must be a decimal string with at most 2 decimals" })
  amount!: string;

  @ApiProperty({ example: 24 })
  @IsInt()
  @Min(0)
  @Max(600)
  tenorMonths!: number;

  @ApiProperty({ example: 31 })
  @IsInt()
  @Min(0)
  @Max(130)
  ageYears!: number;

  @ApiProperty({ example: "78000.00" })
  @IsDecimal(DECIMAL, { message: "monthlyIncome must be a decimal string with at most 2 decimals" })
  monthlyIncome!: string;

  @ApiProperty({ example: "9000.00" })
  @IsDecimal(DECIMAL, {
    message: "monthlyObligations must be a decimal string with at most 2 decimals",
  })
  monthlyObligations!: string;
}
