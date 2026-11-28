import type { Role } from "@loan/core";
import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from "typeorm";
import { LoanCaseEntity } from "../../cases/entities/loan-case.entity";

/**
 * An in-app alert for staff (PRD NTF-002): to one person (an assignment) or to everyone in a
 * role (work waiting for that role). Written in the transaction of the change it announces;
 * `dedupKey` keeps a time-based alert (an SLA breach) to one per stage visit.
 */
@Entity({ name: "staff_notification" })
@Index("IDX_staff_notification_recipient", ["recipientRole", "createdAt"])
@Index("UQ_staff_notification_dedup", ["dedupKey"], {
  unique: true,
  where: `"dedup_key" IS NOT NULL`,
})
export class StaffNotificationEntity {
  @PrimaryGeneratedColumn("uuid", { primaryKeyConstraintName: "PK_staff_notification_id" })
  id!: string;

  /** Everyone in this role sees it, unless `recipientStaffId` names one person. */
  @Column({ name: "recipient_role", type: "varchar", length: 40 })
  recipientRole!: Role;

  @Column({ name: "recipient_staff_id", type: "varchar", length: 40, nullable: true })
  recipientStaffId!: string | null;

  @Column({ name: "case_id", type: "uuid", nullable: true })
  caseId!: string | null;

  @ManyToOne(() => LoanCaseEntity, { onDelete: "NO ACTION" })
  @JoinColumn({ name: "case_id", foreignKeyConstraintName: "FK_staff_notification_case" })
  loanCase?: LoanCaseEntity;

  /** Machine-readable, e.g. ASSIGNED, APPROVAL_WAITING, SLA_BREACHED. */
  @Column({ type: "varchar", length: 40 })
  kind!: string;

  @Column({ type: "varchar", length: 200 })
  title!: string;

  @Column({ name: "dedup_key", type: "varchar", length: 120, nullable: true })
  dedupKey!: string | null;

  @CreateDateColumn({ name: "created_at", type: "timestamptz" })
  createdAt!: Date;

  /** When it was marked read, and by whom (a role alert is read once for the role). */
  @Column({ name: "read_at", type: "timestamptz", nullable: true })
  readAt!: Date | null;

  @Column({ name: "read_by", type: "varchar", length: 40, nullable: true })
  readBy!: string | null;
}

/**
 * A message to the borrower and what became of it (PRD NTF-001, NTF-003): an outbox row
 * written in the transaction of the change, then handed to the gateway by the dispatcher.
 * The words are kept here (the case's delivery log); the address never is.
 */
@Entity({ name: "notification_delivery" })
@Index("IDX_notification_delivery_case", ["caseId", "createdAt"])
@Index("IDX_notification_delivery_status", ["status", "createdAt"])
@Index("UQ_notification_delivery_key", ["idempotencyKey"], { unique: true })
export class NotificationDeliveryEntity {
  @PrimaryGeneratedColumn("uuid", { primaryKeyConstraintName: "PK_notification_delivery_id" })
  id!: string;

  @Column({ name: "case_id", type: "uuid" })
  caseId!: string;

  @ManyToOne(() => LoanCaseEntity, { onDelete: "NO ACTION" })
  @JoinColumn({ name: "case_id", foreignKeyConstraintName: "FK_notification_delivery_case" })
  loanCase?: LoanCaseEntity;

  @Column({ type: "varchar", length: 10 })
  channel!: "EMAIL" | "SMS";

  @Column({ type: "varchar", length: 40 })
  template!: string;

  /** Who it is for, in words (e.g. "Applicant, email on file"); never an address. */
  @Column({ name: "recipient_label", type: "varchar", length: 80 })
  recipientLabel!: string;

  @Column({ type: "varchar", length: 200 })
  subject!: string;

  @Column({ type: "text" })
  body!: string;

  /** One key per message, kept for every attempt (the gateway is idempotent on it). */
  @Column({ name: "idempotency_key", type: "varchar", length: 80 })
  idempotencyKey!: string;

  @Column({ type: "varchar", length: 10 })
  status!: "PENDING" | "SENT" | "FAILED";

  @Column({ type: "integer", default: 0 })
  attempts!: number;

  @Column({ name: "provider_reference", type: "varchar", length: 40, nullable: true })
  providerReference!: string | null;

  @Column({ name: "provider_mode", type: "varchar", length: 20, nullable: true })
  providerMode!: string | null;

  @Column({ name: "last_error", type: "text", nullable: true })
  lastError!: string | null;

  /** A sweep's lease on the message while it is with the gateway (claimNext). */
  @Column({ name: "claimed_until", type: "timestamptz", nullable: true })
  claimedUntil!: Date | null;

  /** When the last attempt was recorded (one attempt per message per sweep). */
  @Column({ name: "last_attempt_at", type: "timestamptz", nullable: true })
  lastAttemptAt!: Date | null;

  @CreateDateColumn({ name: "created_at", type: "timestamptz" })
  createdAt!: Date;

  @Column({ name: "sent_at", type: "timestamptz", nullable: true })
  sentAt!: Date | null;
}
