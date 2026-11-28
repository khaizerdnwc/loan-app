import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from "typeorm";
import { ApplicantEntity } from "./applicant.entity";
import { LoanCaseEntity } from "./loan-case.entity";

/**
 * The applicant's consents for one application (PRD INT-006, CMP-001): the credit bureau
 * check, processing under the Data Privacy Act, and the terms version agreed to, with the
 * channel and who captured them on the applicant's behalf. Insert-only (a database trigger
 * refuses UPDATE and DELETE): a correction is a new record, and the latest one applies.
 */
@Entity({ name: "consent_record" })
@Index("IDX_consent_record_case_captured", ["caseId", "capturedAt"])
export class ConsentRecordEntity {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Column({ name: "case_id", type: "uuid" })
  caseId!: string;

  /** Consent belongs to an existing application; no orphan records. */
  @ManyToOne(() => LoanCaseEntity, { onDelete: "NO ACTION" })
  @JoinColumn({ name: "case_id", foreignKeyConstraintName: "FK_consent_record_case" })
  loanCase?: LoanCaseEntity;

  @Column({ name: "applicant_id", type: "varchar", length: 40 })
  applicantId!: string;

  @ManyToOne(() => ApplicantEntity, { onDelete: "NO ACTION" })
  @JoinColumn({ name: "applicant_id", foreignKeyConstraintName: "FK_consent_record_applicant" })
  applicant?: ApplicantEntity;

  @Column({ name: "credit_bureau_check", type: "boolean" })
  creditBureauCheck!: boolean;

  @Column({ name: "data_processing", type: "boolean" })
  dataProcessing!: boolean;

  @Column({ name: "terms_version", type: "varchar", length: 20 })
  termsVersion!: string;

  /** How consent was captured; staff-assisted at a branch in this release. */
  @Column({ type: "varchar", length: 30 })
  channel!: string;

  @Column({ name: "captured_by", type: "varchar", length: 40 })
  capturedBy!: string;

  /**
   * The moment the row was written (clock_timestamp(), not the transaction's start), so
   * "latest" follows the order the lock let the writes through.
   */
  @CreateDateColumn({
    name: "captured_at",
    type: "timestamptz",
    default: () => "clock_timestamp()",
  })
  capturedAt!: Date;
}
