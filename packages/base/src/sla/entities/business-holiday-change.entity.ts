import type { HolidayChangeAction } from "@loan/core";
import { Check, Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from "typeorm";

export type HolidayChangeStatus = "PENDING" | "APPROVED" | "REJECTED";

/**
 * A change to the business calendar (PRD PLT-005): adding or removing one future holiday,
 * drafted by one administrator and applied to `business_holiday` when a different one approves
 * it (maker-checker), or rejected (withdrawn when the drafter rejects it). At most one waits per
 * date: a partial unique index holds that under a race, behind the per-date lock the service
 * takes. No foreign key to `business_holiday`: a date being added is not in it yet. Its history
 * is the audit log (one entry per step).
 */
@Entity({ name: "business_holiday_change" })
@Index("UQ_business_holiday_change_pending_per_date", ["holidayDate"], {
  unique: true,
  where: `"status" = 'PENDING'`,
})
@Check("CHK_business_holiday_change_action", `"action" IN ('ADD', 'REMOVE')`)
@Check("CHK_business_holiday_change_status", `"status" IN ('PENDING', 'APPROVED', 'REJECTED')`)
export class BusinessHolidayChangeEntity {
  @PrimaryGeneratedColumn("uuid", { primaryKeyConstraintName: "PK_business_holiday_change_id" })
  id!: string;

  @Column({ type: "varchar", length: 6 })
  action!: HolidayChangeAction;

  /** Manila calendar date, YYYY-MM-DD. */
  @Column({ name: "holiday_date", type: "date" })
  holidayDate!: string;

  /** The name to add, or the name of the holiday being removed (as it was when drafted). */
  @Column({ type: "varchar", length: 80 })
  name!: string;

  @Column({ type: "text" })
  reason!: string;

  @Column({ type: "varchar", length: 10 })
  status!: HolidayChangeStatus;

  @Column({ name: "requested_by", type: "varchar", length: 40 })
  requestedBy!: string;

  @CreateDateColumn({ name: "requested_at", type: "timestamptz" })
  requestedAt!: Date;

  @Column({ name: "decided_by", type: "varchar", length: 40, nullable: true })
  decidedBy!: string | null;

  @Column({ name: "decided_at", type: "timestamptz", nullable: true })
  decidedAt!: Date | null;

  @Column({ name: "decision_note", type: "text", nullable: true })
  decisionNote!: string | null;
}
