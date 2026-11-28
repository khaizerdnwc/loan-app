import { HolidayChangeAction } from "@loan/core";
import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { IsIn, IsOptional, IsString, Length, Matches, MaxLength } from "class-validator";

/**
 * Draft adding or removing one future holiday, for a second administrator to approve. Each
 * message starts with its field (the problem filter reads the field from the first word) and
 * goes on in words, as the calendar's dialog shows them (fieldErrorsOf drops the token).
 */
export class HolidayChangeDto {
  @ApiProperty({ enum: Object.values(HolidayChangeAction) })
  @IsIn(Object.values(HolidayChangeAction), {
    message: "action Choose to add or to remove a holiday.",
  })
  action!: HolidayChangeAction;

  @ApiProperty({ example: "2027-01-04", description: "Manila calendar date, after today." })
  @IsString({ message: "date Enter a date." })
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: "date Enter a real date, YYYY-MM-DD." })
  date!: string;

  @ApiPropertyOptional({ maxLength: 80, description: "Required to add; ignored to remove." })
  @IsOptional()
  @IsString({ message: "name Enter a name." })
  @MaxLength(80, { message: "name Keep the name to 80 characters or fewer." })
  name?: string;

  @ApiProperty({ maxLength: 500 })
  @IsString({ message: "reason Enter a reason." })
  @Length(1, 500, { message: "reason Enter a reason of 500 characters or fewer." })
  reason!: string;
}

export class DecideHolidayChangeDto {
  @ApiPropertyOptional({ maxLength: 500 })
  @IsOptional()
  @IsString({ message: "note Enter the note as text." })
  @MaxLength(500, { message: "note Keep the note to 500 characters or fewer." })
  note?: string;
}
