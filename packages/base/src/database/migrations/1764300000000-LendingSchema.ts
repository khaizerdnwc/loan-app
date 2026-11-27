import { MigrationInterface, QueryRunner } from "typeorm";

export class LendingSchema1764300000000 implements MigrationInterface {
  name = "LendingSchema1764300000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    // uuid_generate_v4() for the uuid primary keys; created here so a fresh database
    // never depends on the driver having installed it at connect time.
    await queryRunner.query(`CREATE EXTENSION IF NOT EXISTS "uuid-ossp"`);
    await queryRunner.query(
      `CREATE TABLE "activity_event" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "case_id" uuid NOT NULL, "actor_id" character varying(40) NOT NULL, "actor_name" character varying(120) NOT NULL, "actor_role" character varying(40) NOT NULL, "action" character varying(40) NOT NULL, "summary" text NOT NULL, "from_status" character varying(30), "to_status" character varying(30), "details" jsonb NOT NULL, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_c2c1e9fdda754a6bf7f664d7e04" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_94c3ce059b138eb7456b845fbb" ON "activity_event" ("case_id", "created_at") `,
    );
    await queryRunner.query(
      `CREATE TABLE "applicant" ("id" character varying(40) NOT NULL, "full_name" character varying(120) NOT NULL, "birth_date" date NOT NULL, "government_id_last4" character varying(4) NOT NULL, "employer" character varying(160) NOT NULL, "employment_months" integer NOT NULL, "relationship_months" integer NOT NULL, "monthly_income" numeric(14,2) NOT NULL, "monthly_obligations" numeric(14,2) NOT NULL, "deposit_account" character varying(40) NOT NULL, CONSTRAINT "PK_f4a6e907b8b17f293eb073fc5ea" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE TABLE "booking_request" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "case_id" uuid NOT NULL, "idempotency_key" character varying(60) NOT NULL, "status" character varying(10) NOT NULL, "maker_id" character varying(40) NOT NULL, "checker_id" character varying(40), "attempts" integer NOT NULL DEFAULT '0', "last_error" text, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "UQ_71640893610c00d4b925624d8b4" UNIQUE ("case_id"), CONSTRAINT "UQ_52cf268cb7a3f22c6aed0f93df8" UNIQUE ("idempotency_key"), CONSTRAINT "PK_aa4e0da4a49be8782cd00bf5a99" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE TABLE "loan_account" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "case_id" uuid NOT NULL, "core_account_number" character varying(30) NOT NULL, "booking_request_id" uuid NOT NULL, "principal" numeric(14,2) NOT NULL, "interest" numeric(14,2) NOT NULL, "total_repayable" numeric(14,2) NOT NULL, "monthly_rate" character varying(10) NOT NULL, "tenor_months" integer NOT NULL, "opened_at" TIMESTAMP WITH TIME ZONE NOT NULL, "provider_mode" character varying(12) NOT NULL, CONSTRAINT "UQ_1efcb9bb6a082c3ea00513f07be" UNIQUE ("case_id"), CONSTRAINT "UQ_3082c03afcbaf49a80a71803e0a" UNIQUE ("core_account_number"), CONSTRAINT "PK_1b7d127843420007697e522442e" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE TABLE "schedule_line" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "loan_account_id" uuid NOT NULL, "number" integer NOT NULL, "due_date" date NOT NULL, "principal" numeric(14,2) NOT NULL, "interest" numeric(14,2) NOT NULL, "amount" numeric(14,2) NOT NULL, CONSTRAINT "PK_3ada65cdd7ae3dc7b66d6b20b8e" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_915f5be92dfa9f6f1d0ad08665" ON "schedule_line" ("loan_account_id", "number") `,
    );
    await queryRunner.query(
      `CREATE TABLE "disbursement" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "loan_account_id" uuid NOT NULL, "idempotency_key" character varying(60) NOT NULL, "reference" character varying(40) NOT NULL, "amount" numeric(14,2) NOT NULL, "destination_account" character varying(40) NOT NULL, "disbursed_at" TIMESTAMP WITH TIME ZONE NOT NULL, "provider_mode" character varying(12) NOT NULL, CONSTRAINT "UQ_1014dc72f1b2b27a558ea14f61e" UNIQUE ("loan_account_id"), CONSTRAINT "UQ_39abdd357221ff043601f4d64d1" UNIQUE ("idempotency_key"), CONSTRAINT "PK_463ed35f32b733386261ab7d7fa" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE TABLE "decision_record" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "case_id" uuid NOT NULL, "inputs" jsonb NOT NULL, "inputs_hash" character(64) NOT NULL, "rule_set_version" character varying(20) NOT NULL, "scorecard_version" character varying(20) NOT NULL, "outcome" character varying(20) NOT NULL, "score" integer, "grade" character varying(1), "rule_results" jsonb NOT NULL, "score_contributions" jsonb NOT NULL, "reason_codes" jsonb NOT NULL, "referral_triggers" jsonb NOT NULL, "debt_to_income" character varying(10), "monthly_rate" character varying(10), "provider_mode" character varying(12) NOT NULL, "decided_by" character varying(40) NOT NULL, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_a1974f73499afc0beeb5735c188" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_d8ec07e38958bd5a799c3713cf" ON "decision_record" ("case_id") `,
    );
    await queryRunner.query(
      `CREATE TABLE "loan_case" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "reference" character varying(20) NOT NULL, "applicant_id" character varying(40) NOT NULL, "product_code" character varying(10) NOT NULL, "requested_amount" numeric(14,2) NOT NULL, "requested_tenor_months" integer NOT NULL, "purpose" character varying(120) NOT NULL, "status" character varying(30) NOT NULL, "created_by" character varying(40) NOT NULL, "decision_id" uuid, "grade" character varying(1), "recommended_by" character varying(40), "recommendation" character varying(20), "recommended_amount" numeric(14,2), "recommended_tenor_months" integer, "is_override" boolean NOT NULL DEFAULT false, "override_reason" character varying(8), "recommendation_rationale" text, "escalated" boolean NOT NULL DEFAULT false, "approved_by" character varying(40), "approved_amount" numeric(14,2), "approved_tenor_months" integer, "approved_monthly_rate" character varying(10), "decline_reason" character varying(8), "decline_note" text, "signature_envelope_id" character varying(60), "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "version" integer NOT NULL, CONSTRAINT "UQ_b30b29f40ce1136d036ea070158" UNIQUE ("reference"), CONSTRAINT "PK_642e9a4319b5d98eca58e334275" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_d56a4f1bcfcf3f54718d721056" ON "loan_case" ("status") `,
    );
    await queryRunner.query(
      `CREATE TABLE "staff" ("id" character varying(40) NOT NULL, "full_name" character varying(120) NOT NULL, "role" character varying(40) NOT NULL, "title" character varying(120) NOT NULL, "approval_limit" numeric(14,2), "approval_grades" character varying array, CONSTRAINT "PK_e4ee98bb552756c180aec1e854a" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `ALTER TABLE "loan_case" ADD CONSTRAINT "FK_117c75271b989e98b7a7872ac84" FOREIGN KEY ("applicant_id") REFERENCES "applicant"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "loan_case" DROP CONSTRAINT "FK_117c75271b989e98b7a7872ac84"`,
    );
    await queryRunner.query(`DROP TABLE "staff"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_d56a4f1bcfcf3f54718d721056"`);
    await queryRunner.query(`DROP TABLE "loan_case"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_d8ec07e38958bd5a799c3713cf"`);
    await queryRunner.query(`DROP TABLE "decision_record"`);
    await queryRunner.query(`DROP TABLE "disbursement"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_915f5be92dfa9f6f1d0ad08665"`);
    await queryRunner.query(`DROP TABLE "schedule_line"`);
    await queryRunner.query(`DROP TABLE "loan_account"`);
    await queryRunner.query(`DROP TABLE "booking_request"`);
    await queryRunner.query(`DROP TABLE "applicant"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_94c3ce059b138eb7456b845fbb"`);
    await queryRunner.query(`DROP TABLE "activity_event"`);
  }
}
