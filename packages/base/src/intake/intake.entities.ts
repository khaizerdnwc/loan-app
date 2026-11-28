import type {
  DocumentType,
  ExtractionFlag,
  IntakeDraftStatus,
  IntakeSource,
  Money,
  ProviderMode,
} from "@loan/core";
import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  VersionColumn,
} from "typeorm";
import { ApplicantEntity } from "../cases/entities/applicant.entity";
import { CaseDocumentEntity } from "../cases/entities/case-document.entity";
import { LoanCaseEntity } from "../cases/entities/loan-case.entity";
import { moneyColumn } from "../database/money.transformer";

/**
 * One uploaded file (PRD INT-010, F4): an emailed bundle or a partner's spreadsheet, read by
 * the (simulated) OCR provider. Only the provider's metadata is kept: no file content exists.
 * Insert-only.
 */
@Entity({ name: "intake_batch" })
export class IntakeBatchEntity {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  /** The OCR provider's reference for the reading, e.g. OCR-B-1A2B3C4D. */
  @Index("UQ_intake_batch_reference", { unique: true })
  @Column({ type: "varchar", length: 40 })
  reference!: string;

  @Column({ type: "varchar", length: 30 })
  source!: IntakeSource;

  @Column({ name: "file_name", type: "varchar", length: 160 })
  fileName!: string;

  /** Identifies the file's content, so the same file is not turned into drafts twice. */
  @Column({ type: "varchar", length: 80 })
  fingerprint!: string;

  @Column({ name: "row_count", type: "integer" })
  rowCount!: number;

  @Column({ name: "provider_mode", type: "varchar", length: 20 })
  providerMode!: ProviderMode;

  @Column({ name: "uploaded_by", type: "varchar", length: 40 })
  uploadedBy!: string;

  @CreateDateColumn({ name: "uploaded_at", type: "timestamptz" })
  uploadedAt!: Date;
}

/**
 * One application OCR extracted from a batch: what was read (as extracted, never edited), the
 * customer on record it matches, the flags for a person, and the loan officer's verdict. A
 * confirmed draft points at the case draft it became. Pending drafts of one file are unique
 * per row (a second upload of the same file is refused while the first waits).
 */
@Entity({ name: "intake_draft" })
@Index("UQ_intake_draft_pending_row", ["fingerprint", "rowNumber"], {
  unique: true,
  where: `"status" = 'PENDING_REVIEW'`,
})
@Index("UQ_intake_draft_case", ["caseId"], { unique: true, where: `"case_id" IS NOT NULL` })
@Index("IDX_intake_draft_batch", ["batchId"])
export class IntakeDraftEntity {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Column({ name: "batch_id", type: "uuid" })
  batchId!: string;

  @ManyToOne(() => IntakeBatchEntity, { onDelete: "NO ACTION" })
  @JoinColumn({ name: "batch_id", foreignKeyConstraintName: "FK_intake_draft_batch" })
  batch?: IntakeBatchEntity;

  @Column({ type: "varchar", length: 80 })
  fingerprint!: string;

  @Column({ name: "row_number", type: "integer" })
  rowNumber!: number;

  @Column({ name: "source_detail", type: "varchar", length: 200 })
  sourceDetail!: string;

  // --- as extracted by OCR (never changed after insert) ------------------------------------
  @Column({ name: "full_name", type: "varchar", length: 120, nullable: true })
  fullName!: string | null;

  @Column({ name: "birth_date", type: "date", nullable: true })
  birthDate!: string | null;

  @Column({ name: "government_id_last4", type: "varchar", length: 4, nullable: true })
  governmentIdLast4!: string | null;

  @Column({ type: "varchar", length: 160, nullable: true })
  employer!: string | null;

  @Column(moneyColumn({ name: "declared_monthly_income", nullable: true }))
  declaredMonthlyIncome!: Money | null;

  @Column(moneyColumn({ name: "document_monthly_income", nullable: true }))
  documentMonthlyIncome!: Money | null;

  @Column(moneyColumn({ name: "amount", nullable: true }))
  amount!: Money | null;

  @Column({ name: "tenor_months", type: "integer", nullable: true })
  tenorMonths!: number | null;

  @Column({ type: "varchar", length: 120, nullable: true })
  purpose!: string | null;

  /** The customer on record whose name, birth date and ID match, found at upload. */
  @Column({ name: "matched_applicant_id", type: "varchar", length: 40, nullable: true })
  matchedApplicantId!: string | null;

  @ManyToOne(() => ApplicantEntity, { onDelete: "NO ACTION" })
  @JoinColumn({
    name: "matched_applicant_id",
    foreignKeyConstraintName: "FK_intake_draft_applicant",
  })
  matchedApplicant?: ApplicantEntity | null;

  @Column({ type: "jsonb", default: () => "'[]'" })
  flags!: ExtractionFlag[];

  @Column({ name: "provider_mode", type: "varchar", length: 20 })
  providerMode!: ProviderMode;

  // --- the loan officer's review -------------------------------------------------------------
  @Column({ type: "varchar", length: 20, default: "PENDING_REVIEW" })
  status!: IntakeDraftStatus;

  @Column({ name: "case_id", type: "uuid", nullable: true })
  caseId!: string | null;

  @ManyToOne(() => LoanCaseEntity, { onDelete: "NO ACTION" })
  @JoinColumn({ name: "case_id", foreignKeyConstraintName: "FK_intake_draft_case" })
  loanCase?: LoanCaseEntity | null;

  @Column({ name: "reviewed_by", type: "varchar", length: 40, nullable: true })
  reviewedBy!: string | null;

  @Column({ name: "reviewed_at", type: "timestamptz", nullable: true })
  reviewedAt!: Date | null;

  /** No customer matched, so the applicant was captured from this draft when it was confirmed. */
  @Column({ name: "applicant_captured", type: "boolean", default: false })
  applicantCaptured!: boolean;

  @Column({ name: "discard_reason", type: "text", nullable: true })
  discardReason!: string | null;

  @VersionColumn()
  version!: number;
}

/**
 * OCR's reading of one upload of a case document (PRD DOC-002, DOC-007): the figures it
 * shows, the statement analysis for bank statements, the application figures it was compared
 * with and the flags that comparison raised. Insert-only (trigger), one per document upload
 * (case document and attempt). It informs the loan officer's review; it never changes the
 * case's decision.
 */
@Entity({ name: "document_extraction" })
@Index("UQ_document_extraction_upload", ["caseDocumentId", "attempt"], { unique: true })
@Index("IDX_document_extraction_case_extracted", ["caseId", "extractedAt"])
export class DocumentExtractionEntity {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Column({ name: "case_id", type: "uuid" })
  caseId!: string;

  @ManyToOne(() => LoanCaseEntity, { onDelete: "NO ACTION" })
  @JoinColumn({ name: "case_id", foreignKeyConstraintName: "FK_document_extraction_case" })
  loanCase?: LoanCaseEntity;

  @Column({ name: "case_document_id", type: "uuid" })
  caseDocumentId!: string;

  @ManyToOne(() => CaseDocumentEntity, { onDelete: "NO ACTION" })
  @JoinColumn({
    name: "case_document_id",
    foreignKeyConstraintName: "FK_document_extraction_document",
  })
  caseDocument?: CaseDocumentEntity;

  @Column({ name: "document_type", type: "varchar", length: 40 })
  documentType!: DocumentType;

  @Column({ type: "integer" })
  attempt!: number;

  @Column({ name: "upload_reference", type: "varchar", length: 40 })
  uploadReference!: string;

  /** The OCR provider's reference for the reading. */
  @Column({ type: "varchar", length: 40 })
  reference!: string;

  @Column({ name: "provider_mode", type: "varchar", length: 20 })
  providerMode!: ProviderMode;

  @Column(moneyColumn({ name: "monthly_income", nullable: true }))
  monthlyIncome!: Money | null;

  @Column({ type: "varchar", length: 160, nullable: true })
  employer!: string | null;

  // --- bank statement analysis (bank statements only) ----------------------------------------
  @Column(moneyColumn({ name: "salary_credit", nullable: true }))
  salaryCredit!: Money | null;

  @Column({ name: "months_with_salary", type: "integer", nullable: true })
  monthsWithSalary!: number | null;

  @Column({ name: "months_covered", type: "integer", nullable: true })
  monthsCovered!: number | null;

  @Column(moneyColumn({ name: "recurring_obligations", nullable: true }))
  recurringObligations!: Money | null;

  @Column(moneyColumn({ name: "average_daily_balance", nullable: true }))
  averageDailyBalance!: Money | null;

  @Column({ name: "returned_items", type: "integer", nullable: true })
  returnedItems!: number | null;

  @Column({ name: "risky_merchants", type: "boolean", nullable: true })
  riskyMerchants!: boolean | null;

  // --- what it was compared with, as the application stood ---------------------------------
  @Column(moneyColumn({ name: "compared_monthly_income" }))
  comparedMonthlyIncome!: Money;

  @Column(moneyColumn({ name: "compared_monthly_obligations" }))
  comparedMonthlyObligations!: Money;

  @Column({ name: "compared_employer", type: "varchar", length: 160 })
  comparedEmployer!: string;

  @Column({ type: "jsonb", default: () => "'[]'" })
  flags!: ExtractionFlag[];

  @Column({ name: "extracted_by", type: "varchar", length: 40 })
  extractedBy!: string;

  @CreateDateColumn({ name: "extracted_at", type: "timestamptz" })
  extractedAt!: Date;
}
