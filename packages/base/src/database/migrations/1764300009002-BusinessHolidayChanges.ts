import type { MigrationInterface, QueryRunner } from "typeorm";

/**
 * Keeping the business calendar from a screen (PRD PLT-005).
 *
 * - `business_holiday_change`: drafts to add or remove one holiday, for maker-checker, at most
 *   one PENDING per date (partial unique index, a backstop behind the per-date advisory lock the
 *   service takes). `action` and `status` are checked here as well as in the service. Not
 *   insert-only (a draft's status is decided), so it takes no refuse_change trigger.
 * - `business_holiday` is unchanged and stays the only table the business clock reads; an
 *   approval inserts or deletes its row in the same transaction as the decision.
 * The history of each change is the audit log. A new table only: nothing existing is altered,
 * and no existing row is touched.
 */
export class BusinessHolidayChanges1764300009002 implements MigrationInterface {
  name = "BusinessHolidayChanges1764300009002";

  async up(q: QueryRunner): Promise<void> {
    await q.query(`CREATE TABLE "business_holiday_change" (
      "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
      "action" character varying(6) NOT NULL,
      "holiday_date" date NOT NULL,
      "name" character varying(80) NOT NULL,
      "reason" text NOT NULL,
      "status" character varying(10) NOT NULL,
      "requested_by" character varying(40) NOT NULL,
      "requested_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
      "decided_by" character varying(40),
      "decided_at" TIMESTAMP WITH TIME ZONE,
      "decision_note" text,
      CONSTRAINT "PK_business_holiday_change_id" PRIMARY KEY ("id"),
      CONSTRAINT "CHK_business_holiday_change_action" CHECK ("action" IN ('ADD', 'REMOVE')),
      CONSTRAINT "CHK_business_holiday_change_status"
        CHECK ("status" IN ('PENDING', 'APPROVED', 'REJECTED')))`);
    await q.query(
      `CREATE UNIQUE INDEX "UQ_business_holiday_change_pending_per_date" ON "business_holiday_change" ("holiday_date") WHERE "status" = 'PENDING'`,
    );
  }

  async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP INDEX "UQ_business_holiday_change_pending_per_date"`);
    await q.query(`DROP TABLE "business_holiday_change"`);
  }
}
