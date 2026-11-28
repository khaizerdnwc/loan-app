import type { ReconciliationFinding, ReconciliationSummary } from "@loan/core";
import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from "typeorm";

/**
 * One reconciliation of lending's booking records against core banking's account feed and
 * the payment rail's feed (PRD BKG-005). Insert-only (the refuse_change() trigger): a later
 * run is a new row, so the history of what was found, and when, is kept.
 */
@Entity({ name: "reconciliation_run" })
@Index("IDX_reconciliation_run_run_at", ["runAt"])
export class ReconciliationRunEntity {
  @PrimaryGeneratedColumn("uuid", { primaryKeyConstraintName: "PK_reconciliation_run_id" })
  id!: string;

  @CreateDateColumn({ name: "run_at", type: "timestamptz" })
  runAt!: Date;

  /** The staff member who ran it. */
  @Column({ name: "run_by", type: "varchar", length: 40 })
  runBy!: string;

  @Column({ name: "provider_mode", type: "varchar", length: 20 })
  providerMode!: string;

  @Column({ type: "jsonb" })
  summary!: ReconciliationSummary;

  @Column({ type: "jsonb" })
  findings!: ReconciliationFinding[];
}
