import type {
  AutomationChangeKind,
  AutomationChangeStatus,
  AutomationMode,
  ExternalEngineRole,
  Role,
} from "@loan/core";
import {
  Check,
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
 * A product's automation (PRD §7.5): its mode and its kill switch. One row per product. The
 * decision reads it under a share lock in the decision's own transaction, and every change
 * takes the row's update lock, so a decision never commits under a mode that was already
 * replaced. A product with no row is treated as OFF (fail safe).
 */
@Entity({ name: "product_automation" })
@Check(
  "CHK_product_automation_external_engine",
  `"external_engine" IN ('NONE', 'ALONGSIDE', 'INSTEAD')`,
)
export class ProductAutomationEntity {
  @PrimaryColumn({ name: "product_code", type: "varchar", length: 10 })
  productCode!: string;

  @Column({ type: "varchar", length: 10 })
  mode!: AutomationMode;

  @Column({ name: "kill_switch", type: "boolean", default: false })
  killSwitch!: boolean;

  @Column({ name: "kill_switch_set_by", type: "varchar", length: 40, nullable: true })
  killSwitchSetBy!: string | null;

  @Column({ name: "kill_switch_set_at", type: "timestamptz", nullable: true })
  killSwitchSetAt!: Date | null;

  /** Whether, and how, a decision calls the external decision engine (PRD DEC-008). */
  @Column({ name: "external_engine", type: "varchar", length: 10, default: "NONE" })
  externalEngine!: ExternalEngineRole;

  @Column({ name: "updated_at", type: "timestamptz", default: () => "now()" })
  updatedAt!: Date;
}

/**
 * A change to a product's automation, drafted by one administrator and approved or rejected
 * by another (maker-checker; withdrawn when the drafter rejects it). At most one change waits
 * per product: a partial unique index holds that under a race.
 */
@Entity({ name: "automation_change" })
@Index("UQ_automation_change_pending_per_product", ["productCode"], {
  unique: true,
  where: `"status" = 'PENDING'`,
})
/** A role change names the role it asks for; no other change does. */
@Check(
  "CHK_automation_change_external_engine",
  `("kind" = 'SET_EXTERNAL_ENGINE') = ("requested_external_engine" IS NOT NULL)`,
)
export class AutomationChangeEntity {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Column({ name: "product_code", type: "varchar", length: 10 })
  productCode!: string;

  @ManyToOne(() => ProductAutomationEntity, { onDelete: "NO ACTION" })
  @JoinColumn({ name: "product_code", foreignKeyConstraintName: "FK_automation_change_product" })
  product?: ProductAutomationEntity;

  @Column({ type: "varchar", length: 20 })
  kind!: AutomationChangeKind;

  @Column({ name: "requested_mode", type: "varchar", length: 10, nullable: true })
  requestedMode!: AutomationMode | null;

  /** The mode when the change was drafted: approval is refused if it has moved since. */
  @Column({ name: "from_mode", type: "varchar", length: 10 })
  fromMode!: AutomationMode;

  @Column({ name: "requested_external_engine", type: "varchar", length: 10, nullable: true })
  requestedExternalEngine!: ExternalEngineRole | null;

  /** The external engine's role when drafted: approval is refused if it has moved since. */
  @Column({ name: "from_external_engine", type: "varchar", length: 10 })
  fromExternalEngine!: ExternalEngineRole;

  @Column({ type: "text" })
  reason!: string;

  @Column({ type: "varchar", length: 10 })
  status!: AutomationChangeStatus;

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

/**
 * The history of a product's automation: who did what, when, with before and after. Written
 * in the same transaction as the change; insert-only (a trigger refuses UPDATE and DELETE).
 */
@Entity({ name: "automation_event" })
@Index("IDX_automation_event_product_created", ["productCode", "createdAt"])
export class AutomationEventEntity {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Column({ name: "product_code", type: "varchar", length: 10 })
  productCode!: string;

  @ManyToOne(() => ProductAutomationEntity, { onDelete: "NO ACTION" })
  @JoinColumn({ name: "product_code", foreignKeyConstraintName: "FK_automation_event_product" })
  product?: ProductAutomationEntity;

  @Column({ name: "change_id", type: "uuid", nullable: true })
  changeId!: string | null;

  /** The change request this event records (null for the kill switch turned on). */
  @ManyToOne(() => AutomationChangeEntity, { onDelete: "NO ACTION" })
  @JoinColumn({ name: "change_id", foreignKeyConstraintName: "FK_automation_event_change" })
  change?: AutomationChangeEntity;

  /** e.g. MODE_CHANGE_REQUESTED, MODE_CHANGED, KILL_SWITCH_ON. */
  @Column({ type: "varchar", length: 40 })
  action!: string;

  @Column({ name: "actor_id", type: "varchar", length: 40 })
  actorId!: string;

  @Column({ name: "actor_name", type: "varchar", length: 120 })
  actorName!: string;

  @Column({ name: "actor_role", type: "varchar", length: 40 })
  actorRole!: Role;

  @Column({ type: "text" })
  summary!: string;

  /** Before and after, and the reason given. */
  @Column({ type: "jsonb" })
  details!: Record<string, unknown>;

  @CreateDateColumn({ name: "created_at", type: "timestamptz" })
  createdAt!: Date;
}
