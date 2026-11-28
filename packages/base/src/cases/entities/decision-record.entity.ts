import type { AutomationMode, DecisionOutcome, Grade, Money, ProviderMode } from "@loan/core";
import {
  Check,
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from "typeorm";
import { moneyColumn } from "../../database/money.transformer";
import type {
  DecisionInputs,
  ReasonCode,
  RuleResult,
  ScoreContribution,
} from "../../decisioning/engine";

/**
 * The automated decision, insert-only (ADR 0022 R3). The repository has no update or
 * delete, and a trigger in the migration rejects UPDATE and DELETE at the database.
 * `inputs` plus the two versions reproduce `outcome` and everything after it.
 */
@Entity({ name: "decision_record" })
@Index(["caseId"])
/** The latency and decision-mix windows read by date (`GET /decisions/latency`). */
@Index("IDX_decision_record_created", ["createdAt"])
/** Only RS-PL-1 records (made before automation modes) may lack the engine's outcome. */
@Check(
  "CHK_decision_record_engine_outcome",
  `"engine_outcome" IS NOT NULL OR "rule_set_version" = 'RS-PL-1'`,
)
export class DecisionRecordEntity {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Column({ name: "case_id", type: "uuid" })
  caseId!: string;

  /**
   * A decision belongs to an existing case; nothing cascades into it. The target is named by
   * string and the property typed structurally, not as LoanCaseEntity, so this file does not
   * import loan-case.entity.ts, which imports this one for `LoanCaseEntity.decision`
   * (no-circular in .dependency-cruiser.cjs counts type-only imports too). Declared only so the
   * foreign key is part of the entity metadata (drift check); nothing loads it.
   */
  @ManyToOne("LoanCaseEntity", { onDelete: "NO ACTION" })
  @JoinColumn({ name: "case_id", foreignKeyConstraintName: "FK_decision_record_case" })
  loanCase?: { id: string };

  @Column({ type: "jsonb" })
  inputs!: DecisionInputs;

  @Column({ name: "inputs_hash", type: "char", length: 64 })
  inputsHash!: string;

  @Column({ name: "rule_set_version", type: "varchar", length: 20 })
  ruleSetVersion!: string;

  @Column({ name: "scorecard_version", type: "varchar", length: 20 })
  scorecardVersion!: string;

  @Column({ type: "varchar", length: 20 })
  outcome!: DecisionOutcome;

  @Column({ type: "integer", nullable: true })
  score!: number | null;

  @Column({ type: "varchar", length: 1, nullable: true })
  grade!: Grade | null;

  @Column({ name: "rule_results", type: "jsonb" })
  ruleResults!: RuleResult[];

  @Column({ name: "score_contributions", type: "jsonb" })
  scoreContributions!: ScoreContribution[];

  @Column({ name: "reason_codes", type: "jsonb" })
  reasonCodes!: ReasonCode[];

  @Column({ name: "referral_triggers", type: "jsonb" })
  referralTriggers!: string[];

  @Column({ name: "debt_to_income", type: "varchar", length: 10, nullable: true })
  debtToIncome!: string | null;

  @Column({ name: "monthly_rate", type: "varchar", length: 10, nullable: true })
  monthlyRate!: string | null;

  /**
   * The mode of the providers that supplied the inputs (PRD IH-008). DecisionService refuses
   * to start if the bureau and KYC/AML ports report different modes, so one value is exact.
   */
  @Column({ name: "provider_mode", type: "varchar", length: 12 })
  providerMode!: ProviderMode;

  /**
   * The product's automation mode when the decision was made (PRD §7.5), also in `inputs`.
   * Records from before modes existed read LIVE (the migration's backfill): they ran live.
   */
  @Column({ name: "automation_mode", type: "varchar", length: 10 })
  automationMode!: AutomationMode;

  /** Whether the product's kill switch was on (also in `inputs`). */
  @Column({ name: "kill_switch", type: "boolean" })
  killSwitch!: boolean;

  /**
   * What the rules and score decided before the mode applied; `outcome` is what the case did.
   * Null on records from before modes existed, where the two are the same.
   */
  @Column({ name: "engine_outcome", type: "varchar", length: 20, nullable: true })
  engineOutcome!: DecisionOutcome | null;

  /** 12-month probability of default for the grade (SC-PL-2 on); null before or without a grade. */
  @Column({ type: "varchar", length: 10, nullable: true })
  pd!: string | null;

  /** The largest affordable amount up to the one requested (RS-PL-3 on); null before. */
  @Column(moneyColumn({ name: "recommended_amount", nullable: true }))
  recommendedAmount!: Money | null;

  /**
   * Milliseconds from gathering the inputs to writing this record (PRD NFR-003). A
   * measurement, not part of the decision: reproduce ignores it. Null on older records.
   */
  @Column({ name: "latency_ms", type: "integer", nullable: true })
  latencyMs!: number | null;

  @Column({ name: "decided_by", type: "varchar", length: 40 })
  decidedBy!: string;

  @CreateDateColumn({ name: "created_at", type: "timestamptz" })
  createdAt!: Date;
}
