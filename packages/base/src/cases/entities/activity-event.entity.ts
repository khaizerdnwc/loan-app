import type { CaseStatus, Role } from "@loan/core";
import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from "typeorm";

/**
 * Who did what and when, with before and after (PRD LND-WF-011). Written in the same
 * transaction as the change it describes; insert-only like the decision record.
 */
@Entity({ name: "activity_event" })
@Index(["caseId", "createdAt"])
export class ActivityEventEntity {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Column({ name: "case_id", type: "uuid" })
  caseId!: string;

  @Column({ name: "actor_id", type: "varchar", length: 40 })
  actorId!: string;

  @Column({ name: "actor_name", type: "varchar", length: 120 })
  actorName!: string;

  @Column({ name: "actor_role", type: "varchar", length: 40 })
  actorRole!: Role | "SYSTEM";

  /** Machine-readable action, e.g. CASE_SUBMITTED, BOOKING_APPROVED. */
  @Column({ type: "varchar", length: 40 })
  action!: string;

  /** One sentence for the history view. */
  @Column({ type: "text" })
  summary!: string;

  @Column({ name: "from_status", type: "varchar", length: 30, nullable: true })
  fromStatus!: CaseStatus | null;

  @Column({ name: "to_status", type: "varchar", length: 30, nullable: true })
  toStatus!: CaseStatus | null;

  @Column({ type: "jsonb" })
  details!: Record<string, unknown>;

  @CreateDateColumn({ name: "created_at", type: "timestamptz" })
  createdAt!: Date;
}
