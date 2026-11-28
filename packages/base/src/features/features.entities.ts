import type { FeatureFlag } from "@loan/core";
import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryColumn,
  PrimaryGeneratedColumn,
} from "typeorm";

/**
 * One switchable module for the bank (PRD PLT-006). One row per flag, seeded by the migration
 * (every module on, as before flags existed). Every change takes the row's update lock, so two
 * approvals cannot both apply, and a module's state is read from here on each use.
 */
@Entity({ name: "feature_flag" })
export class FeatureFlagEntity {
  @PrimaryColumn({ type: "varchar", length: 40 })
  key!: FeatureFlag;

  @Column({ type: "boolean" })
  enabled!: boolean;

  @Column({ name: "updated_by", type: "varchar", length: 40, nullable: true })
  updatedBy!: string | null;

  @Column({ name: "updated_at", type: "timestamptz", default: () => "now()" })
  updatedAt!: Date;
}

export type FeatureFlagChangeStatus = "PENDING" | "APPROVED" | "REJECTED";

/**
 * A change to a flag, drafted by one administrator and approved by another (maker-checker), or
 * rejected (withdrawn when the drafter rejects it). At most one waits per flag: a partial unique
 * index holds that under a race. Its history is the audit log (one entry per step).
 */
@Entity({ name: "feature_flag_change" })
@Index("UQ_feature_flag_change_pending_per_flag", ["flagKey"], {
  unique: true,
  where: `"status" = 'PENDING'`,
})
export class FeatureFlagChangeEntity {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Column({ name: "flag_key", type: "varchar", length: 40 })
  flagKey!: FeatureFlag;

  @ManyToOne(() => FeatureFlagEntity, { onDelete: "NO ACTION" })
  @JoinColumn({ name: "flag_key", foreignKeyConstraintName: "FK_feature_flag_change_flag" })
  flag?: FeatureFlagEntity;

  /** What the flag becomes on approval. */
  @Column({ name: "requested_enabled", type: "boolean" })
  requestedEnabled!: boolean;

  @Column({ type: "text" })
  reason!: string;

  @Column({ type: "varchar", length: 10 })
  status!: FeatureFlagChangeStatus;

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
