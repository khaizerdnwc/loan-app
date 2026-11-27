import { type Grade, type Money, Role } from "@loan/core";
import { Column, Entity, PrimaryColumn, Unique } from "typeorm";
import { moneyColumn } from "../database/money.transformer";

/** A seeded staff member with a test sign-in (username + scrypt-hashed test password). */
@Entity({ name: "staff" })
@Unique("UQ_staff_username", ["username"])
export class StaffEntity {
  @PrimaryColumn({ type: "varchar", length: 40 })
  id!: string;

  /** Sign-in name, unique (e.g. "paolo"). */
  @Column({ type: "varchar", length: 40 })
  username!: string;

  /** scrypt hash (auth/password.ts); never returned by the API or logged. */
  @Column({ name: "password_hash", type: "varchar", length: 200, select: false })
  passwordHash!: string;

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
