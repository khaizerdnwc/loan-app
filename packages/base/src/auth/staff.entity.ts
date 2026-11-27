import { type Grade, type Money, Role } from "@loan/core";
import { Column, Entity, PrimaryColumn } from "typeorm";
import { moneyColumn } from "../database/money.transformer";

/** A seeded staff member. Demo sign-in picks one of these; there are no passwords. */
@Entity({ name: "staff" })
export class StaffEntity {
  @PrimaryColumn({ type: "varchar", length: 40 })
  id!: string;

  @Column({ name: "full_name", type: "varchar", length: 120 })
  fullName!: string;

  @Column({ type: "varchar", length: 40, enum: Object.values(Role) })
  role!: Role;

  @Column({ type: "varchar", length: 120 })
  title!: string;

  /** Approvers only: the largest amount they may approve. */
  @Column(moneyColumn({ name: "approval_limit", nullable: true }))
  approvalLimit!: Money | null;

  /** Approvers only: the risk grades they may approve. */
  @Column({ name: "approval_grades", type: "varchar", array: true, nullable: true })
  approvalGrades!: Grade[] | null;
}
