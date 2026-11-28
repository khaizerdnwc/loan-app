import type { MigrationInterface, QueryRunner } from "typeorm";

/**
 * The hash-chained audit log (PRD PLT-004, CMP-010) and AML escalations (PRD CMP-005, F6).
 *
 * audit_event is insert-only, stricter than the case history: the refuse_change() trigger
 * from 1764300000002 refuses UPDATE and DELETE row by row, and TRUNCATE for the statement.
 * The chain starts empty: activity recorded before this migration stays in the case
 * histories and is not back-filled into the log.
 *
 * aml_escalation rows change status (open, acknowledged, closed), each change with its case
 * activity event; a partial unique index keeps one unclosed escalation per case and stage.
 * New tables only: nothing existing is altered.
 */
export class AuditLogAndAmlEscalations1764300002000 implements MigrationInterface {
  name = "AuditLogAndAmlEscalations1764300002000";

  async up(q: QueryRunner): Promise<void> {
    await q.query(`CREATE TABLE "audit_event" (
      "seq" bigint NOT NULL,
      "occurred_at" TIMESTAMP WITH TIME ZONE NOT NULL,
      "actor_id" character varying(40) NOT NULL,
      "actor_name" character varying(120) NOT NULL,
      "actor_role" character varying(40) NOT NULL,
      "action" character varying(60) NOT NULL,
      "case_id" uuid,
      "case_reference" character varying(20),
      "summary" text NOT NULL,
      "details" jsonb NOT NULL,
      "prev_hash" character(64) NOT NULL,
      "hash" character(64) NOT NULL,
      CONSTRAINT "PK_audit_event_seq" PRIMARY KEY ("seq"))`);
    await q.query(`CREATE INDEX "IDX_audit_event_occurred_at" ON "audit_event" ("occurred_at")`);
    await q.query(`CREATE INDEX "IDX_audit_event_actor" ON "audit_event" ("actor_id")`);
    await q.query(`CREATE INDEX "IDX_audit_event_action" ON "audit_event" ("action")`);
    await q.query(
      `CREATE INDEX "IDX_audit_event_case_reference" ON "audit_event" ("case_reference")`,
    );
    await q.query(`CREATE TRIGGER audit_event_insert_only BEFORE UPDATE OR DELETE ON audit_event
      FOR EACH ROW EXECUTE FUNCTION refuse_change()`);
    await q.query(`CREATE TRIGGER audit_event_no_truncate BEFORE TRUNCATE ON audit_event
      FOR EACH STATEMENT EXECUTE FUNCTION refuse_change()`);

    await q.query(`CREATE TABLE "aml_escalation" (
      "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
      "case_id" uuid NOT NULL,
      "applicant_id" character varying(40) NOT NULL,
      "stage" character varying(20) NOT NULL,
      "decision_id" uuid,
      "matched_list" character varying(120),
      "provider_mode" character varying(20) NOT NULL,
      "screened_at" TIMESTAMP WITH TIME ZONE NOT NULL,
      "status" character varying(20) NOT NULL,
      "opened_by" character varying(40) NOT NULL,
      "opened_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
      "acknowledged_by" character varying(40),
      "acknowledged_at" TIMESTAMP WITH TIME ZONE,
      "closed_by" character varying(40),
      "closed_at" TIMESTAMP WITH TIME ZONE,
      "outcome" character varying(20),
      "closing_notes" text,
      "prior_booking_attempts" integer NOT NULL DEFAULT 0,
      CONSTRAINT "PK_aml_escalation_id" PRIMARY KEY ("id"),
      CONSTRAINT "FK_aml_escalation_case" FOREIGN KEY ("case_id") REFERENCES "loan_case"("id")
        ON DELETE NO ACTION ON UPDATE NO ACTION,
      CONSTRAINT "FK_aml_escalation_decision" FOREIGN KEY ("decision_id")
        REFERENCES "decision_record"("id") ON DELETE NO ACTION ON UPDATE NO ACTION)`);
    await q.query(
      `CREATE UNIQUE INDEX "UQ_aml_escalation_open_per_case_stage" ON "aml_escalation" ("case_id", "stage") WHERE "status" <> 'CLOSED'`,
    );
    await q.query(
      `CREATE INDEX "IDX_aml_escalation_status_opened" ON "aml_escalation" ("status", "opened_at")`,
    );
  }

  async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP INDEX "public"."IDX_aml_escalation_status_opened"`);
    await q.query(`DROP INDEX "public"."UQ_aml_escalation_open_per_case_stage"`);
    await q.query(`DROP TABLE "aml_escalation"`);
    await q.query("DROP TRIGGER audit_event_no_truncate ON audit_event");
    await q.query("DROP TRIGGER audit_event_insert_only ON audit_event");
    await q.query(`DROP INDEX "public"."IDX_audit_event_case_reference"`);
    await q.query(`DROP INDEX "public"."IDX_audit_event_action"`);
    await q.query(`DROP INDEX "public"."IDX_audit_event_actor"`);
    await q.query(`DROP INDEX "public"."IDX_audit_event_occurred_at"`);
    await q.query(`DROP TABLE "audit_event"`);
  }
}
