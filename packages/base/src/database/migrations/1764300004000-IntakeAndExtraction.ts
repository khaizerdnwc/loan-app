import type { MigrationInterface, QueryRunner } from "typeorm";

/**
 * Email and file intake with OCR, and OCR with bank statement analysis on case documents
 * (PRD INT-010, DOC-002, DOC-007, F4).
 *
 * - `intake_batch`: one uploaded (synthetic) file read by the simulated OCR provider: its
 *   reference, file name and content fingerprint. Insert-only (row trigger refusing UPDATE and
 *   DELETE, statement trigger refusing TRUNCATE, as 1764300009000 does for the older tables).
 * - `intake_draft`: one application OCR extracted from a batch, with the customer it matched,
 *   its flags and the loan officer's verdict (confirmed into a case draft, or discarded). A
 *   partial unique index keeps one pending draft per file row, so the same file cannot wait
 *   for review twice; another keeps one draft per case.
 * - `document_extraction`: OCR's reading of one upload of a case document (figures, statement
 *   analysis, what it was compared with, flags). One per upload (case document and attempt).
 *   Insert-only (UPDATE, DELETE and TRUNCATE refused).
 * - `sim.document_profile`: what the simulated OCR reads from each synthetic applicant's
 *   documents (seeded), in the simulators' own schema.
 *
 * Purely additive: new tables only, nothing existing is altered or backfilled, so it cannot
 * fail on existing rows. down() drops them (intake drafts and readings are lost; demo data,
 * all synthetic).
 */
export class IntakeAndExtraction1764300004000 implements MigrationInterface {
  name = "IntakeAndExtraction1764300004000";

  async up(q: QueryRunner): Promise<void> {
    await q.query(`CREATE TABLE "intake_batch" (
      "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
      "reference" character varying(40) NOT NULL,
      "source" character varying(30) NOT NULL,
      "file_name" character varying(160) NOT NULL,
      "fingerprint" character varying(80) NOT NULL,
      "row_count" integer NOT NULL,
      "provider_mode" character varying(20) NOT NULL,
      "uploaded_by" character varying(40) NOT NULL,
      "uploaded_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
      CONSTRAINT "PK_intake_batch_id" PRIMARY KEY ("id"))`);
    await q.query(
      `CREATE UNIQUE INDEX "UQ_intake_batch_reference" ON "intake_batch" ("reference")`,
    );
    await q.query(`CREATE TABLE "intake_draft" (
      "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
      "batch_id" uuid NOT NULL,
      "fingerprint" character varying(80) NOT NULL,
      "row_number" integer NOT NULL,
      "source_detail" character varying(200) NOT NULL,
      "full_name" character varying(120),
      "birth_date" date,
      "government_id_last4" character varying(4),
      "employer" character varying(160),
      "declared_monthly_income" numeric(14,2),
      "document_monthly_income" numeric(14,2),
      "amount" numeric(14,2),
      "tenor_months" integer,
      "purpose" character varying(120),
      "matched_applicant_id" character varying(40),
      "flags" jsonb NOT NULL DEFAULT '[]',
      "provider_mode" character varying(20) NOT NULL,
      "status" character varying(20) NOT NULL DEFAULT 'PENDING_REVIEW',
      "case_id" uuid,
      "reviewed_by" character varying(40),
      "reviewed_at" TIMESTAMP WITH TIME ZONE,
      "discard_reason" text,
      "version" integer NOT NULL,
      CONSTRAINT "PK_intake_draft_id" PRIMARY KEY ("id"),
      CONSTRAINT "FK_intake_draft_batch" FOREIGN KEY ("batch_id") REFERENCES "intake_batch"("id")
        ON DELETE NO ACTION ON UPDATE NO ACTION,
      CONSTRAINT "FK_intake_draft_applicant" FOREIGN KEY ("matched_applicant_id")
        REFERENCES "applicant"("id") ON DELETE NO ACTION ON UPDATE NO ACTION,
      CONSTRAINT "FK_intake_draft_case" FOREIGN KEY ("case_id") REFERENCES "loan_case"("id")
        ON DELETE NO ACTION ON UPDATE NO ACTION)`);
    await q.query(`CREATE UNIQUE INDEX "UQ_intake_draft_case" ON "intake_draft" ("case_id")
      WHERE "case_id" IS NOT NULL`);
    await q.query(`CREATE UNIQUE INDEX "UQ_intake_draft_pending_row" ON "intake_draft" ("fingerprint", "row_number")
      WHERE "status" = 'PENDING_REVIEW'`);
    await q.query(`CREATE INDEX "IDX_intake_draft_batch" ON "intake_draft" ("batch_id")`);
    await q.query(`CREATE TABLE "document_extraction" (
      "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
      "case_id" uuid NOT NULL,
      "case_document_id" uuid NOT NULL,
      "document_type" character varying(40) NOT NULL,
      "attempt" integer NOT NULL,
      "upload_reference" character varying(40) NOT NULL,
      "reference" character varying(40) NOT NULL,
      "provider_mode" character varying(20) NOT NULL,
      "monthly_income" numeric(14,2),
      "employer" character varying(160),
      "salary_credit" numeric(14,2),
      "months_with_salary" integer,
      "months_covered" integer,
      "recurring_obligations" numeric(14,2),
      "average_daily_balance" numeric(14,2),
      "returned_items" integer,
      "risky_merchants" boolean,
      "compared_monthly_income" numeric(14,2) NOT NULL,
      "compared_monthly_obligations" numeric(14,2) NOT NULL,
      "compared_employer" character varying(160) NOT NULL,
      "flags" jsonb NOT NULL DEFAULT '[]',
      "extracted_by" character varying(40) NOT NULL,
      "extracted_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
      CONSTRAINT "PK_document_extraction_id" PRIMARY KEY ("id"),
      CONSTRAINT "FK_document_extraction_case" FOREIGN KEY ("case_id") REFERENCES "loan_case"("id")
        ON DELETE NO ACTION ON UPDATE NO ACTION,
      CONSTRAINT "FK_document_extraction_document" FOREIGN KEY ("case_document_id")
        REFERENCES "case_document"("id") ON DELETE NO ACTION ON UPDATE NO ACTION)`);
    await q.query(
      `CREATE UNIQUE INDEX "UQ_document_extraction_upload" ON "document_extraction" ("case_document_id", "attempt")`,
    );
    // The case's readings, in order: what every extractions view and extract reads.
    await q.query(
      `CREATE INDEX "IDX_document_extraction_case_extracted" ON "document_extraction" ("case_id", "extracted_at")`,
    );
    await q.query(`CREATE TRIGGER intake_batch_insert_only BEFORE UPDATE OR DELETE ON intake_batch
      FOR EACH ROW EXECUTE FUNCTION refuse_change()`);
    await q.query(`CREATE TRIGGER document_extraction_insert_only BEFORE UPDATE OR DELETE ON document_extraction
      FOR EACH ROW EXECUTE FUNCTION refuse_change()`);
    // TRUNCATE empties a table without touching a row, so the row triggers cannot see it.
    await q.query(`CREATE TRIGGER intake_batch_no_truncate BEFORE TRUNCATE ON "intake_batch"
      FOR EACH STATEMENT EXECUTE FUNCTION refuse_change()`);
    await q.query(`CREATE TRIGGER document_extraction_no_truncate BEFORE TRUNCATE ON "document_extraction"
      FOR EACH STATEMENT EXECUTE FUNCTION refuse_change()`);
    await q.query(`CREATE TABLE sim.document_profile (
      applicant_id varchar(40) PRIMARY KEY,
      payload jsonb NOT NULL
    )`);
  }

  async down(q: QueryRunner): Promise<void> {
    await q.query("DROP TABLE sim.document_profile");
    await q.query("DROP TRIGGER document_extraction_no_truncate ON document_extraction");
    await q.query("DROP TRIGGER intake_batch_no_truncate ON intake_batch");
    await q.query("DROP TRIGGER document_extraction_insert_only ON document_extraction");
    await q.query("DROP TRIGGER intake_batch_insert_only ON intake_batch");
    await q.query(`DROP INDEX "public"."IDX_document_extraction_case_extracted"`);
    await q.query(`DROP INDEX "public"."UQ_document_extraction_upload"`);
    await q.query(`DROP TABLE "document_extraction"`);
    await q.query(`DROP INDEX "public"."IDX_intake_draft_batch"`);
    await q.query(`DROP INDEX "public"."UQ_intake_draft_pending_row"`);
    await q.query(`DROP INDEX "public"."UQ_intake_draft_case"`);
    await q.query(`DROP TABLE "intake_draft"`);
    await q.query(`DROP INDEX "public"."UQ_intake_batch_reference"`);
    await q.query(`DROP TABLE "intake_batch"`);
  }
}
