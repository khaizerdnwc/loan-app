import type { MigrationInterface, QueryRunner } from "typeorm";

/**
 * Consent records (PRD INT-006, CMP-001): one row per capture, insert-only like the decision
 * record and the activity history (the refuse_change() trigger from 1764300000002).
 */
export class ConsentRecords1764300000004 implements MigrationInterface {
  name = "ConsentRecords1764300000004";

  async up(q: QueryRunner): Promise<void> {
    await q.query(`CREATE TABLE "consent_record" (
      "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
      "case_id" uuid NOT NULL,
      "applicant_id" character varying(40) NOT NULL,
      "credit_bureau_check" boolean NOT NULL,
      "data_processing" boolean NOT NULL,
      "terms_version" character varying(20) NOT NULL,
      "channel" character varying(30) NOT NULL,
      "captured_by" character varying(40) NOT NULL,
      "captured_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT clock_timestamp(),
      CONSTRAINT "PK_consent_record_id" PRIMARY KEY ("id"),
      CONSTRAINT "FK_consent_record_case" FOREIGN KEY ("case_id") REFERENCES "loan_case"("id")
        ON DELETE NO ACTION ON UPDATE NO ACTION)`);
    await q.query(
      `CREATE INDEX "IDX_consent_record_case_captured" ON "consent_record" ("case_id", "captured_at")`,
    );
    await q.query(`CREATE TRIGGER consent_record_insert_only BEFORE UPDATE OR DELETE ON consent_record
      FOR EACH ROW EXECUTE FUNCTION refuse_change()`);
  }

  async down(q: QueryRunner): Promise<void> {
    await q.query("DROP TRIGGER consent_record_insert_only ON consent_record");
    await q.query(`DROP INDEX "IDX_consent_record_case_captured"`);
    await q.query(`DROP TABLE "consent_record"`);
  }
}
