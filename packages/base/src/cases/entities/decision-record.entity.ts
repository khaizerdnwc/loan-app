import type { DecisionOutcome, Grade, ProviderMode } from "@loan/core";
import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from "typeorm";
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
export class DecisionRecordEntity {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Column({ name: "case_id", type: "uuid" })
  caseId!: string;

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

  @Column({ name: "decided_by", type: "varchar", length: 40 })
  decidedBy!: string;

  @CreateDateColumn({ name: "created_at", type: "timestamptz" })
  createdAt!: Date;
}
