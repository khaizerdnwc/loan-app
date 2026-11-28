import type { MigrationInterface, QueryRunner } from "typeorm";

/**
 * The holiday calendar the Philippine business clock skips (PRD PLT-005), for stage SLAs
 * and turnaround (PRD WF-003, RPT-002). Rows come from the seed. A new table: nothing
 * existing is altered.
 */
export class BusinessHolidays1764300002002 implements MigrationInterface {
  name = "BusinessHolidays1764300002002";

  async up(q: QueryRunner): Promise<void> {
    await q.query(`CREATE TABLE "business_holiday" (
      "date" date NOT NULL,
      "name" character varying(80) NOT NULL,
      CONSTRAINT "PK_business_holiday_date" PRIMARY KEY ("date"))`);
  }

  async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP TABLE "business_holiday"`);
  }
}
