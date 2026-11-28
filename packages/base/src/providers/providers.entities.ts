import type { Money, ProviderMode, ServiceName } from "@loan/core";
import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryColumn,
  PrimaryGeneratedColumn,
  type Relation,
} from "typeorm";
import { LoanCaseEntity } from "../cases/entities/loan-case.entity";
import { moneyColumn } from "../database/money.transformer";

export type ProviderCallOutcome = "OK" | "FAILED" | "SHORT_CIRCUITED" | "CACHE_HIT";

/**
 * One provider call attempt, or one call answered without the provider (circuit open, cached
 * bureau report): the per-call cost counter (PRD IH-006) and the evidence for retries and the
 * circuit breaker (IH-003). Insert-only (the refuse_change() trigger). Holds no applicant data.
 */
@Entity({ name: "provider_call" })
@Index("IDX_provider_call_created_service", ["createdAt", "service"])
export class ProviderCallEntity {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Column({ type: "varchar", length: 30 })
  service!: ServiceName;

  /** e.g. PULL_REPORT, SCREEN, ASSESS. */
  @Column({ type: "varchar", length: 30 })
  operation!: string;

  @Column({ type: "varchar", length: 20 })
  outcome!: ProviderCallOutcome;

  /** OUTAGE, TIMEOUT or MALFORMED when the attempt failed. */
  @Column({ type: "varchar", length: 10, nullable: true })
  failure!: string | null;

  /** 1 for the first try; retries count up. 0 for a call that never reached the provider. */
  @Column({ type: "integer" })
  attempt!: number;

  @Column({ name: "duration_ms", type: "integer" })
  durationMs!: number;

  /** The simulated price charged for this attempt (only a successful call costs). */
  @Column(moneyColumn())
  cost!: Money;

  /**
   * The application being decided, when there is one (null for a call made outside a case).
   * A foreign key to the case (migration 1764300009000), NO ACTION like every key on a child
   * table: cases are never deleted, so no retention job removes the rows this points at, and the
   * row is insert-only, so ON DELETE SET NULL would be refused anyway.
   */
  @Column({ name: "case_id", type: "uuid", nullable: true })
  caseId!: string | null;

  @ManyToOne(() => LoanCaseEntity, { onDelete: "NO ACTION" })
  @JoinColumn({ name: "case_id", foreignKeyConstraintName: "FK_provider_call_case" })
  loanCase?: Relation<LoanCaseEntity>;

  @CreateDateColumn({ name: "created_at", type: "timestamptz" })
  createdAt!: Date;
}

/**
 * The last bureau report pulled for an applicant, reused for the reuse window (PRD IH-005:
 * 30 days) instead of a new, charged pull. One row per applicant and provider mode (a report
 * from a simulated bureau is never reused by a decision under another mode); a fresh pull
 * replaces it.
 */
@Entity({ name: "bureau_report_cache" })
export class BureauReportCacheEntity {
  @PrimaryColumn({ name: "applicant_id", type: "varchar", length: 40 })
  applicantId!: string;

  @PrimaryColumn({ type: "varchar", length: 12 })
  mode!: ProviderMode;

  /** The report fields the decision uses (no provider payload beyond them). */
  @Column({ type: "jsonb" })
  report!: Record<string, unknown>;

  @Column({ name: "retrieved_at", type: "timestamptz" })
  retrievedAt!: Date;
}
