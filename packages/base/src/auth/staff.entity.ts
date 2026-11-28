import { Role } from "@loan/core";
import { Column, Entity, JoinColumn, ManyToOne, PrimaryColumn, Unique } from "typeorm";
import { ApprovalLevelEntity } from "./approval-level.entity";

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

  /** Approvers only: their delegated level in the approval matrix (PRD WF-004). */
  @Column({ name: "approval_level", type: "varchar", length: 10, nullable: true })
  approvalLevelCode!: string | null;

  /** The level itself, loaded with the staff member so every authority check can read it. */
  @ManyToOne(() => ApprovalLevelEntity, { eager: true, nullable: true, onDelete: "NO ACTION" })
  @JoinColumn({ name: "approval_level", foreignKeyConstraintName: "FK_staff_approval_level" })
  approvalLevel!: ApprovalLevelEntity | null;
}
