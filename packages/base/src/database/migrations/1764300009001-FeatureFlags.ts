import type { MigrationInterface, QueryRunner } from "typeorm";

/**
 * Feature flags (PRD PLT-006: switch modules on or off for the bank).
 *
 * - `feature_flag`: one row per switchable module, seeded ON, which is how both modules ran
 *   before flags existed, so nothing changes until two administrators change it.
 * - `feature_flag_change`: drafts for maker-checker, at most one PENDING per flag (partial
 *   unique index, a backstop behind the row lock the service takes). Not insert-only (a
 *   draft's status is decided), so it takes no refuse_change trigger.
 * The history of each change is the audit log. New tables only: nothing existing is altered.
 */
export class FeatureFlags1764300009001 implements MigrationInterface {
  name = "FeatureFlags1764300009001";

  async up(q: QueryRunner): Promise<void> {
    await q.query(`CREATE TABLE "feature_flag" (
      "key" character varying(40) NOT NULL,
      "enabled" boolean NOT NULL,
      "updated_by" character varying(40),
      "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
      CONSTRAINT "PK_feature_flag_key" PRIMARY KEY ("key"))`);
    await q.query(
      `INSERT INTO "feature_flag" ("key", "enabled") VALUES ('ELIGIBILITY_PRECHECK', true), ('EMAIL_INTAKE', true)`,
    );
    await q.query(`CREATE TABLE "feature_flag_change" (
      "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
      "flag_key" character varying(40) NOT NULL,
      "requested_enabled" boolean NOT NULL,
      "reason" text NOT NULL,
      "status" character varying(10) NOT NULL,
      "requested_by" character varying(40) NOT NULL,
      "requested_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
      "decided_by" character varying(40),
      "decided_at" TIMESTAMP WITH TIME ZONE,
      "decision_note" text,
      CONSTRAINT "PK_feature_flag_change_id" PRIMARY KEY ("id"),
      CONSTRAINT "FK_feature_flag_change_flag" FOREIGN KEY ("flag_key")
        REFERENCES "feature_flag"("key") ON DELETE NO ACTION ON UPDATE NO ACTION)`);
    await q.query(
      `CREATE UNIQUE INDEX "UQ_feature_flag_change_pending_per_flag" ON "feature_flag_change" ("flag_key") WHERE "status" = 'PENDING'`,
    );
  }

  async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP INDEX "UQ_feature_flag_change_pending_per_flag"`);
    await q.query(`DROP TABLE "feature_flag_change"`);
    await q.query(`DROP TABLE "feature_flag"`);
  }
}
