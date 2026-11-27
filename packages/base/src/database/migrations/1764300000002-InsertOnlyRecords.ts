import type { MigrationInterface, QueryRunner } from "typeorm";

/**
 * Decision records and activity events are insert-only (ADR 0022 R3, PRD LND-WF-011): the
 * database itself refuses UPDATE and DELETE on them, whatever the application does. Also
 * the sequence behind case references (APP-1001, APP-1002, …).
 */
export class InsertOnlyRecords1764300000002 implements MigrationInterface {
  name = "InsertOnlyRecords1764300000002";

  async up(q: QueryRunner): Promise<void> {
    await q.query(`CREATE FUNCTION refuse_change() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        RAISE EXCEPTION '% is insert-only: % refused', TG_TABLE_NAME, TG_OP;
      END $$`);
    await q.query(`CREATE TRIGGER decision_record_insert_only BEFORE UPDATE OR DELETE ON decision_record
      FOR EACH ROW EXECUTE FUNCTION refuse_change()`);
    await q.query(`CREATE TRIGGER activity_event_insert_only BEFORE UPDATE OR DELETE ON activity_event
      FOR EACH ROW EXECUTE FUNCTION refuse_change()`);
    await q.query("CREATE SEQUENCE loan_case_ref_seq START 1001");
  }

  async down(q: QueryRunner): Promise<void> {
    await q.query("DROP SEQUENCE loan_case_ref_seq");
    await q.query("DROP TRIGGER activity_event_insert_only ON activity_event");
    await q.query("DROP TRIGGER decision_record_insert_only ON decision_record");
    await q.query("DROP FUNCTION refuse_change()");
  }
}
