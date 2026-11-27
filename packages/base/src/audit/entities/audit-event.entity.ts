import { Column, Entity, Index, PrimaryColumn } from "typeorm";

/**
 * The audit log (PRD PLT-004, CMP-010): every sign-in, simulation mode change and case
 * activity (consent records and AML escalation work included), in one hash chain. Each row
 * stores sha256(previous row's hash + its own canonical form), so changing, removing or
 * reordering a row breaks every hash after it (`GET /audit/verify` recomputes the chain).
 * Insert-only: database triggers refuse UPDATE, DELETE and TRUNCATE.
 *
 * `seq` is assigned as the previous seq + 1 under a transaction-scoped advisory lock (no
 * sequence, so a rolled-back transaction leaves no gap that would read as a removed row).
 */
@Entity({ name: "audit_event" })
@Index("IDX_audit_event_occurred_at", ["occurredAt"])
@Index("IDX_audit_event_actor", ["actorId"])
@Index("IDX_audit_event_action", ["action"])
@Index("IDX_audit_event_case_reference", ["caseReference"])
export class AuditEventEntity {
  @PrimaryColumn({ type: "bigint", primaryKeyConstraintName: "PK_audit_event_seq" })
  seq!: string;

  @Column({ name: "occurred_at", type: "timestamptz" })
  occurredAt!: Date;

  /** A staff id, SYSTEM for the decision engine, or UNKNOWN for a sign-in with no account. */
  @Column({ name: "actor_id", type: "varchar", length: 40 })
  actorId!: string;

  @Column({ name: "actor_name", type: "varchar", length: 120 })
  actorName!: string;

  @Column({ name: "actor_role", type: "varchar", length: 40 })
  actorRole!: string;

  /** Machine-readable, e.g. SIGN_IN_SUCCEEDED, SIMULATION_MODE_CHANGED, CASE_SUBMITTED. */
  @Column({ type: "varchar", length: 60 })
  action!: string;

  @Column({ name: "case_id", type: "uuid", nullable: true })
  caseId!: string | null;

  @Column({ name: "case_reference", type: "varchar", length: 20, nullable: true })
  caseReference!: string | null;

  @Column({ type: "text" })
  summary!: string;

  /** Never a password, a token or a request body. */
  @Column({ type: "jsonb" })
  details!: Record<string, unknown>;

  /** The previous row's hash; 64 zeros for the first row. */
  @Column({ name: "prev_hash", type: "char", length: 64 })
  prevHash!: string;

  @Column({ type: "char", length: 64 })
  hash!: string;
}
