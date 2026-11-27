import type { MigrationInterface, QueryRunner } from "typeorm";

/**
 * Requests for information and the document checklist (PRD WF-007, DOC-003, DOC-001 simulated).
 *
 * - `loan_case.info_request_*`: the latest request sent to the borrower (documents, message,
 *   due date, who and when). Nullable: existing cases have none.
 * - `case_document`: one row per case and document type, with the synthetic upload metadata
 *   and the officer's review. No file content is stored anywhere.
 * - `sim.document_upload` and `sim.document_seq`: the simulated intake's own idempotent store.
 *
 * Purely additive, so it cannot fail on existing rows. down() refuses while a case is in
 * INFO_REQUESTED: the older code has no such status (demo databases only, all data synthetic).
 */
export class InfoRequestAndDocuments1764300001000 implements MigrationInterface {
  name = "InfoRequestAndDocuments1764300001000";

  async up(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE "loan_case" ADD "info_request_documents" jsonb`);
    await q.query(`ALTER TABLE "loan_case" ADD "info_request_message" text`);
    await q.query(`ALTER TABLE "loan_case" ADD "info_request_due" date`);
    await q.query(`ALTER TABLE "loan_case" ADD "info_requested_by" character varying(40)`);
    await q.query(`ALTER TABLE "loan_case" ADD "info_requested_at" TIMESTAMP WITH TIME ZONE`);
    await q.query(`CREATE TABLE "case_document" (
      "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
      "case_id" uuid NOT NULL,
      "document_type" character varying(40) NOT NULL,
      "status" character varying(20) NOT NULL DEFAULT 'REQUESTED',
      "attempt" integer NOT NULL DEFAULT 1,
      "requested_by" character varying(40) NOT NULL,
      "requested_at" TIMESTAMP WITH TIME ZONE NOT NULL,
      "upload_reference" character varying(40),
      "file_name" character varying(120),
      "content_type" character varying(60),
      "size_bytes" integer,
      "pages" integer,
      "received_at" TIMESTAMP WITH TIME ZONE,
      "provider_mode" character varying(20),
      "reviewed_by" character varying(40),
      "reviewed_at" TIMESTAMP WITH TIME ZONE,
      "rejection_reason" text,
      "version" integer NOT NULL,
      CONSTRAINT "PK_case_document_id" PRIMARY KEY ("id"),
      CONSTRAINT "FK_case_document_case" FOREIGN KEY ("case_id") REFERENCES "loan_case"("id")
        ON DELETE NO ACTION ON UPDATE NO ACTION)`);
    await q.query(
      `CREATE UNIQUE INDEX "UQ_case_document_case_type" ON "case_document" ("case_id", "document_type")`,
    );
    await q.query(`CREATE TABLE sim.document_upload (
      idempotency_key varchar(80) PRIMARY KEY,
      reference varchar(40) NOT NULL UNIQUE,
      application_id varchar(60) NOT NULL,
      payload jsonb NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now()
    )`);
    await q.query("CREATE SEQUENCE sim.document_seq START 1");
  }

  async down(q: QueryRunner): Promise<void> {
    const [{ n }] = (await q.query(
      `SELECT count(*)::int AS n FROM "loan_case" WHERE "status" = 'INFO_REQUESTED'`,
    )) as [{ n: number }];
    if (n > 0) {
      throw new Error(
        `Cannot revert InfoRequestAndDocuments: ${n} case(s) are waiting for information. Reset the demo database instead.`,
      );
    }
    await q.query("DROP SEQUENCE sim.document_seq");
    await q.query("DROP TABLE sim.document_upload");
    await q.query(`DROP INDEX "public"."UQ_case_document_case_type"`);
    await q.query(`DROP TABLE "case_document"`);
    await q.query(`ALTER TABLE "loan_case" DROP COLUMN "info_requested_at"`);
    await q.query(`ALTER TABLE "loan_case" DROP COLUMN "info_requested_by"`);
    await q.query(`ALTER TABLE "loan_case" DROP COLUMN "info_request_due"`);
    await q.query(`ALTER TABLE "loan_case" DROP COLUMN "info_request_message"`);
    await q.query(`ALTER TABLE "loan_case" DROP COLUMN "info_request_documents"`);
  }
}
