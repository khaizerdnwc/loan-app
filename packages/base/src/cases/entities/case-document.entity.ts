import { DocumentStatus, type DocumentType, type ProviderMode } from "@loan/core";
import {
  Column,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  VersionColumn,
} from "typeorm";
import { LoanCaseEntity } from "./loan-case.entity";

/**
 * One line of a case's document checklist (PRD DOC-003): a document requested from the
 * borrower, its simulated upload (metadata only; no file is stored) and the loan officer's
 * verification or rejection. One row per case and document type: a rejected document asked
 * for again goes back to REQUESTED with its attempt counted up. Every change happens with the
 * case row locked and writes an activity event in the same transaction.
 */
@Entity({ name: "case_document" })
@Index("UQ_case_document_case_type", ["caseId", "documentType"], { unique: true })
export class CaseDocumentEntity {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Column({ name: "case_id", type: "uuid" })
  caseId!: string;

  @ManyToOne(() => LoanCaseEntity, { onDelete: "NO ACTION" })
  @JoinColumn({ name: "case_id", foreignKeyConstraintName: "FK_case_document_case" })
  loanCase?: LoanCaseEntity;

  @Column({ name: "document_type", type: "varchar", length: 40 })
  documentType!: DocumentType;

  @Column({ type: "varchar", length: 20, default: DocumentStatus.Requested })
  status!: DocumentStatus;

  /** 1 for the first request; counted up each time a rejected document is asked for again. */
  @Column({ type: "integer", default: 1 })
  attempt!: number;

  @Column({ name: "requested_by", type: "varchar", length: 40 })
  requestedBy!: string;

  @Column({ name: "requested_at", type: "timestamptz" })
  requestedAt!: Date;

  // --- the simulated upload: synthetic metadata from the document intake port -------------
  @Column({ name: "upload_reference", type: "varchar", length: 40, nullable: true })
  uploadReference!: string | null;

  @Column({ name: "file_name", type: "varchar", length: 120, nullable: true })
  fileName!: string | null;

  @Column({ name: "content_type", type: "varchar", length: 60, nullable: true })
  contentType!: string | null;

  @Column({ name: "size_bytes", type: "integer", nullable: true })
  sizeBytes!: number | null;

  @Column({ type: "integer", nullable: true })
  pages!: number | null;

  @Column({ name: "received_at", type: "timestamptz", nullable: true })
  receivedAt!: Date | null;

  @Column({ name: "provider_mode", type: "varchar", length: 20, nullable: true })
  providerMode!: ProviderMode | null;

  // --- the loan officer's review ------------------------------------------------------------
  @Column({ name: "reviewed_by", type: "varchar", length: 40, nullable: true })
  reviewedBy!: string | null;

  @Column({ name: "reviewed_at", type: "timestamptz", nullable: true })
  reviewedAt!: Date | null;

  @Column({ name: "rejection_reason", type: "text", nullable: true })
  rejectionReason!: string | null;

  @VersionColumn()
  version!: number;
}
