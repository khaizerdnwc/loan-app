import type { MigrationInterface, QueryRunner } from "typeorm";

/**
 * Notifications (PRD NTF-001..003): staff alerts (`staff_notification`, marked read), the
 * borrower-message outbox and delivery log (`notification_delivery`, status updated by the
 * dispatcher), and the simulated gateway's own idempotent store (`sim.notification`). Neither
 * lending table is insert-only (both are updated by design), so neither carries the
 * refuse_change() triggers. Both reference `loan_case` by a NO ACTION foreign key, as every
 * child table does since H-7. New tables only: nothing existing is altered.
 */
export class Notifications1764300002003 implements MigrationInterface {
  name = "Notifications1764300002003";

  async up(q: QueryRunner): Promise<void> {
    await q.query(`CREATE TABLE "staff_notification" (
      "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
      "recipient_role" character varying(40) NOT NULL,
      "recipient_staff_id" character varying(40),
      "case_id" uuid,
      "kind" character varying(40) NOT NULL,
      "title" character varying(200) NOT NULL,
      "dedup_key" character varying(120),
      "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
      "read_at" TIMESTAMP WITH TIME ZONE,
      "read_by" character varying(40),
      CONSTRAINT "PK_staff_notification_id" PRIMARY KEY ("id"))`);
    await q.query(
      `CREATE INDEX "IDX_staff_notification_recipient" ON "staff_notification" ("recipient_role", "created_at")`,
    );
    await q.query(
      `CREATE UNIQUE INDEX "UQ_staff_notification_dedup" ON "staff_notification" ("dedup_key") WHERE "dedup_key" IS NOT NULL`,
    );

    await q.query(`CREATE TABLE "notification_delivery" (
      "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
      "case_id" uuid NOT NULL,
      "channel" character varying(10) NOT NULL,
      "template" character varying(40) NOT NULL,
      "recipient_label" character varying(80) NOT NULL,
      "subject" character varying(200) NOT NULL,
      "body" text NOT NULL,
      "idempotency_key" character varying(80) NOT NULL,
      "status" character varying(10) NOT NULL,
      "attempts" integer NOT NULL DEFAULT 0,
      "provider_reference" character varying(40),
      "provider_mode" character varying(20),
      "last_error" text,
      "claimed_until" TIMESTAMP WITH TIME ZONE,
      "last_attempt_at" TIMESTAMP WITH TIME ZONE,
      "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
      "sent_at" TIMESTAMP WITH TIME ZONE,
      CONSTRAINT "PK_notification_delivery_id" PRIMARY KEY ("id"))`);
    await q.query(
      `CREATE INDEX "IDX_notification_delivery_case" ON "notification_delivery" ("case_id", "created_at")`,
    );
    await q.query(
      `CREATE INDEX "IDX_notification_delivery_status" ON "notification_delivery" ("status", "created_at")`,
    );
    await q.query(
      `CREATE UNIQUE INDEX "UQ_notification_delivery_key" ON "notification_delivery" ("idempotency_key")`,
    );

    // Every case reference is a key (H-7); nothing cascades: case rows are never deleted.
    await q.query(`ALTER TABLE "staff_notification" ADD CONSTRAINT "FK_staff_notification_case"
      FOREIGN KEY ("case_id") REFERENCES "loan_case"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
    await q.query(`ALTER TABLE "notification_delivery" ADD CONSTRAINT "FK_notification_delivery_case"
      FOREIGN KEY ("case_id") REFERENCES "loan_case"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);

    await q.query(`CREATE TABLE sim.notification (
      idempotency_key varchar(80) PRIMARY KEY,
      reference varchar(40) NOT NULL UNIQUE,
      channel varchar(10) NOT NULL,
      template varchar(40) NOT NULL,
      recipient_ref varchar(80) NOT NULL,
      accepted_at timestamptz NOT NULL DEFAULT now()
    )`);
    await q.query("CREATE SEQUENCE sim.notification_seq START 1");
  }

  async down(q: QueryRunner): Promise<void> {
    await q.query("DROP SEQUENCE sim.notification_seq");
    await q.query("DROP TABLE sim.notification");
    await q.query(
      `ALTER TABLE "notification_delivery" DROP CONSTRAINT "FK_notification_delivery_case"`,
    );
    await q.query(`ALTER TABLE "staff_notification" DROP CONSTRAINT "FK_staff_notification_case"`);
    await q.query(`DROP INDEX "public"."UQ_notification_delivery_key"`);
    await q.query(`DROP INDEX "public"."IDX_notification_delivery_status"`);
    await q.query(`DROP INDEX "public"."IDX_notification_delivery_case"`);
    await q.query(`DROP TABLE "notification_delivery"`);
    await q.query(`DROP INDEX "public"."UQ_staff_notification_dedup"`);
    await q.query(`DROP INDEX "public"."IDX_staff_notification_recipient"`);
    await q.query(`DROP TABLE "staff_notification"`);
  }
}
