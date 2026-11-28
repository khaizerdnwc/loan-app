import {
  type EscalationOutcome,
  EscalationStatus,
  type ProviderMode,
  type ScreeningStage,
} from "@loan/core";
import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from "typeorm";
import { ApplicantEntity } from "../../cases/entities/applicant.entity";
import { DecisionRecordEntity } from "../../cases/entities/decision-record.entity";
import { LoanCaseEntity } from "../../cases/entities/loan-case.entity";

/**
 * A sanctions or watchlist match escalated to Compliance (PRD CMP-005, F6): opened by the
 * decision at application (a knockout) or by the screening the booking runs again before
 * disbursement. Compliance acknowledges it and closes it with notes and an outcome; each step
 * writes the case's activity event (and so the audit log) in the same transaction.
 */
@Entity({ name: "aml_escalation" })
/** One escalation still being worked per case and stage; a closed one does not count. */
@Index("UQ_aml_escalation_open_per_case_stage", ["caseId", "stage"], {
  unique: true,
  where: `"status" <> '${EscalationStatus.Closed}'`,
})
@Index("IDX_aml_escalation_status_opened", ["status", "openedAt"])
export class AmlEscalationEntity {
  @PrimaryGeneratedColumn("uuid", { primaryKeyConstraintName: "PK_aml_escalation_id" })
  id!: string;

  @Column({ name: "case_id", type: "uuid" })
  caseId!: string;

  @ManyToOne(() => LoanCaseEntity, { onDelete: "NO ACTION" })
  @JoinColumn({ name: "case_id", foreignKeyConstraintName: "FK_aml_escalation_case" })
  loanCase?: LoanCaseEntity;

  @Column({ name: "applicant_id", type: "varchar", length: 40 })
  applicantId!: string;

  @ManyToOne(() => ApplicantEntity, { onDelete: "NO ACTION" })
  @JoinColumn({ name: "applicant_id", foreignKeyConstraintName: "FK_aml_escalation_applicant" })
  applicant?: ApplicantEntity;

  @Column({ type: "varchar", length: 20 })
  stage!: ScreeningStage;

  /** The decision record behind an escalation at application. */
  @Column({ name: "decision_id", type: "uuid", nullable: true })
  decisionId!: string | null;

  @ManyToOne(() => DecisionRecordEntity, { onDelete: "NO ACTION" })
  @JoinColumn({ name: "decision_id", foreignKeyConstraintName: "FK_aml_escalation_decision" })
  decision?: DecisionRecordEntity;

  /**
   * Booking attempts made before the one whose screening matched (pre-disbursement only).
   * Above 0, core banking may already hold the account after a lost reply (ADR 0020).
   */
  @Column({ name: "prior_booking_attempts", type: "integer", default: 0 })
  priorBookingAttempts!: number;

  @Column({ name: "matched_list", type: "varchar", length: 120, nullable: true })
  matchedList!: string | null;

  @Column({ name: "provider_mode", type: "varchar", length: 20 })
  providerMode!: ProviderMode;

  @Column({ name: "screened_at", type: "timestamptz" })
  screenedAt!: Date;

  @Column({ type: "varchar", length: 20 })
  status!: EscalationStatus;

  /** SYSTEM (the decision engine) or the staff member whose action ran the screening. */
  @Column({ name: "opened_by", type: "varchar", length: 40 })
  openedBy!: string;

  @CreateDateColumn({ name: "opened_at", type: "timestamptz" })
  openedAt!: Date;

  @Column({ name: "acknowledged_by", type: "varchar", length: 40, nullable: true })
  acknowledgedBy!: string | null;

  @Column({ name: "acknowledged_at", type: "timestamptz", nullable: true })
  acknowledgedAt!: Date | null;

  @Column({ name: "closed_by", type: "varchar", length: 40, nullable: true })
  closedBy!: string | null;

  @Column({ name: "closed_at", type: "timestamptz", nullable: true })
  closedAt!: Date | null;

  @Column({ type: "varchar", length: 20, nullable: true })
  outcome!: EscalationOutcome | null;

  @Column({ name: "closing_notes", type: "text", nullable: true })
  closingNotes!: string | null;
}
