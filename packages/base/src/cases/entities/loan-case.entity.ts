import {
  CaseStatus,
  CLOSED_CASE_STATUSES,
  type DocumentType,
  type Grade,
  type Money,
  type OverrideReason,
  type Recommendation,
  type WithdrawReason,
} from "@loan/core";
import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
  VersionColumn,
} from "typeorm";
import { moneyColumn } from "../../database/money.transformer";
import { ApplicantEntity } from "./applicant.entity";

/**
 * One loan application and everything decided about it. Its `status` only changes through
 * the transition table (lifecycle.ts), inside a transaction that also writes the activity
 * event. Human decisions are fields here; the automated decision is an insert-only record.
 */
@Entity({ name: "loan_case" })
/**
 * One open application per applicant and product (PRD INT-007): closed cases (declined,
 * disbursed, withdrawn, expired) do not count. The service answers 409 first; this index makes it hold under a race.
 */
@Index("UQ_loan_case_open_per_applicant_product", ["applicantId", "productCode"], {
  unique: true,
  where: `"status" NOT IN (${CLOSED_CASE_STATUSES.map((st) => `'${st}'`).join(", ")})`,
})
@Index(["status"])
export class LoanCaseEntity {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  /** Human-readable reference, e.g. APP-1001. */
  @Column({ type: "varchar", length: 20, unique: true })
  reference!: string;

  @ManyToOne(() => ApplicantEntity, { eager: true })
  @JoinColumn({ name: "applicant_id" })
  applicant!: ApplicantEntity;

  @Column({ name: "applicant_id", type: "varchar", length: 40 })
  applicantId!: string;

  @Column({ name: "product_code", type: "varchar", length: 10 })
  productCode!: string;

  @Column(moneyColumn({ name: "requested_amount" }))
  requestedAmount!: Money;

  @Column({ name: "requested_tenor_months", type: "integer" })
  requestedTenorMonths!: number;

  @Column({ type: "varchar", length: 120 })
  purpose!: string;

  @Column({ type: "varchar", length: 30, enum: Object.values(CaseStatus) })
  status!: CaseStatus;

  @Column({ name: "created_by", type: "varchar", length: 40 })
  createdBy!: string;

  // --- automated decision ---------------------------------------------------------------
  @Column({ name: "decision_id", type: "uuid", nullable: true })
  decisionId!: string | null;

  @Column({ type: "varchar", length: 1, nullable: true })
  grade!: Grade | null;

  // --- officer recommendation (referred cases) -------------------------------------------
  @Column({ name: "recommended_by", type: "varchar", length: 40, nullable: true })
  recommendedBy!: string | null;

  @Column({ name: "recommendation", type: "varchar", length: 20, nullable: true })
  recommendation!: Recommendation | null;

  @Column(moneyColumn({ name: "recommended_amount", nullable: true }))
  recommendedAmount!: Money | null;

  @Column({ name: "recommended_tenor_months", type: "integer", nullable: true })
  recommendedTenorMonths!: number | null;

  /** True when the recommendation differs from the automated outcome or terms. */
  @Column({ name: "is_override", type: "boolean", default: false })
  isOverride!: boolean;

  @Column({ name: "override_reason", type: "varchar", length: 8, nullable: true })
  overrideReason!: OverrideReason | null;

  @Column({ name: "recommendation_rationale", type: "text", nullable: true })
  recommendationRationale!: string | null;

  /** Set when an approver without enough authority tried to approve. */
  @Column({ type: "boolean", default: false })
  escalated!: boolean;

  // --- approved terms (auto-approval or approver) ----------------------------------------
  @Column({ name: "approved_by", type: "varchar", length: 40, nullable: true })
  approvedBy!: string | null;

  @Column(moneyColumn({ name: "approved_amount", nullable: true }))
  approvedAmount!: Money | null;

  @Column({ name: "approved_tenor_months", type: "integer", nullable: true })
  approvedTenorMonths!: number | null;

  @Column({ name: "approved_monthly_rate", type: "varchar", length: 10, nullable: true })
  approvedMonthlyRate!: string | null;

  @Column({ name: "decline_reason", type: "varchar", length: 8, nullable: true })
  declineReason!: string | null;

  @Column({ name: "decline_note", type: "text", nullable: true })
  declineNote!: string | null;

  /** When the case last entered OFFER (auto-approval, approval or re-decision); the offer expires from here. */
  @Column({ name: "offered_at", type: "timestamptz", nullable: true })
  offeredAt!: Date | null;

  // --- withdrawal (loan officer, PRD WF-012); who and when are in the WITHDRAWN event -----
  @Column({ name: "withdraw_reason", type: "varchar", length: 30, nullable: true })
  withdrawReason!: WithdrawReason | null;

  @Column({ name: "withdraw_note", type: "text", nullable: true })
  withdrawNote!: string | null;

  // --- request for information (loan officer, PRD WF-007); the latest request -------------
  /** The documents asked for in the latest request (the checklist holds their state). */
  @Column({ name: "info_request_documents", type: "jsonb", nullable: true })
  infoRequestDocuments!: DocumentType[] | null;

  @Column({ name: "info_request_message", type: "text", nullable: true })
  infoRequestMessage!: string | null;

  /** Business date (YYYY-MM-DD) the borrower is asked to answer by; shown, not enforced. */
  @Column({ name: "info_request_due", type: "date", nullable: true })
  infoRequestDue!: string | null;

  @Column({ name: "info_requested_by", type: "varchar", length: 40, nullable: true })
  infoRequestedBy!: string | null;

  @Column({ name: "info_requested_at", type: "timestamptz", nullable: true })
  infoRequestedAt!: Date | null;

  // --- signing ----------------------------------------------------------------------------
  @Column({ name: "signature_envelope_id", type: "varchar", length: 60, nullable: true })
  signatureEnvelopeId!: string | null;

  @CreateDateColumn({ name: "created_at", type: "timestamptz" })
  createdAt!: Date;

  @UpdateDateColumn({ name: "updated_at", type: "timestamptz" })
  updatedAt!: Date;

  @VersionColumn()
  version!: number;
}
