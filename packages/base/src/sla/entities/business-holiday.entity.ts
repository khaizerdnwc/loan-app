import { Column, Entity, PrimaryColumn } from "typeorm";

/**
 * A Philippine non-working day the business clock skips (PRD PLT-005). Seeded with a small
 * synthetic calendar (packages/base/src/seed/seed.ts); a real deployment would load the
 * official proclamations.
 */
@Entity({ name: "business_holiday" })
export class BusinessHolidayEntity {
  /** Manila calendar date, YYYY-MM-DD. */
  @PrimaryColumn({ type: "date", primaryKeyConstraintName: "PK_business_holiday_date" })
  date!: string;

  @Column({ type: "varchar", length: 80 })
  name!: string;
}
