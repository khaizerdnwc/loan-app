import type { MigrationInterface, QueryRunner } from "typeorm";

/**
 * The simulated providers' own schema (`sim`), separate from lending's tables: what a real
 * bureau, core banking system or payments rail would hold on its side. The simulators
 * write here in their own statements, never in lending's transaction (ADR 0020), so a
 * booking that core accepted survives a lending rollback, as it would in real life.
 */
export class SimulatorsSchema1764300000001 implements MigrationInterface {
  name = "SimulatorsSchema1764300000001";

  async up(q: QueryRunner): Promise<void> {
    await q.query("CREATE SCHEMA IF NOT EXISTS sim");
    await q.query(`CREATE TABLE sim.service_mode (
      service varchar(30) PRIMARY KEY,
      mode varchar(20) NOT NULL,
      set_by varchar(120),
      resets_at timestamptz
    )`);
    await q.query(`CREATE TABLE sim.persona_profile (
      applicant_id varchar(40) PRIMARY KEY,
      bureau jsonb NOT NULL,
      screening jsonb NOT NULL
    )`);
    await q.query(`CREATE TABLE sim.core_account (
      idempotency_key varchar(60) PRIMARY KEY,
      account_number varchar(30) NOT NULL UNIQUE,
      application_id varchar(60) NOT NULL,
      payload jsonb NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now()
    )`);
    await q.query(`CREATE TABLE sim.disbursement (
      idempotency_key varchar(60) PRIMARY KEY,
      reference varchar(40) NOT NULL UNIQUE,
      payload jsonb NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now()
    )`);
    await q.query(`CREATE TABLE sim.signature (
      idempotency_key varchar(80) PRIMARY KEY,
      envelope_id varchar(40) NOT NULL UNIQUE,
      payload jsonb NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now()
    )`);
    await q.query("CREATE SEQUENCE sim.core_account_seq START 1001");
    await q.query("CREATE SEQUENCE sim.disbursement_seq START 1");
    await q.query("CREATE SEQUENCE sim.envelope_seq START 1");
  }

  async down(q: QueryRunner): Promise<void> {
    await q.query("DROP SCHEMA sim CASCADE");
  }
}
