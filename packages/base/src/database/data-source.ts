import { DataSource, type DataSourceOptions } from "typeorm";
import { AuditEventEntity } from "../audit/entities/audit-event.entity";
import { StaffEntity } from "../auth/staff.entity";
import {
  AutomationChangeEntity,
  AutomationEventEntity,
  ProductAutomationEntity,
} from "../automation/automation.entities";
import { ActivityEventEntity } from "../cases/entities/activity-event.entity";
import { ApplicantEntity } from "../cases/entities/applicant.entity";
import {
  BookingRequestEntity,
  DisbursementEntity,
  LoanAccountEntity,
  ScheduleLineEntity,
} from "../cases/entities/booking.entities";
import { CaseDocumentEntity } from "../cases/entities/case-document.entity";
import { ConsentRecordEntity } from "../cases/entities/consent-record.entity";
import { DecisionRecordEntity } from "../cases/entities/decision-record.entity";
import { LoanCaseEntity } from "../cases/entities/loan-case.entity";
import { AmlEscalationEntity } from "../compliance/entities/aml-escalation.entity";
import { ReconciliationRunEntity } from "../operations/entities/reconciliation-run.entity";
import { MIGRATIONS } from "./migrations";

/** Every lending entity, listed explicitly (no glob: the same list works from src and dist). */
export const ENTITIES = [
  StaffEntity,
  ApplicantEntity,
  LoanCaseEntity,
  DecisionRecordEntity,
  BookingRequestEntity,
  LoanAccountEntity,
  ScheduleLineEntity,
  DisbursementEntity,
  ActivityEventEntity,
  ConsentRecordEntity,
  AuditEventEntity,
  AmlEscalationEntity,
  ProductAutomationEntity,
  AutomationChangeEntity,
  AutomationEventEntity,
  CaseDocumentEntity,
  ReconciliationRunEntity,
];

/**
 * The one way to configure the database. The schema changes only through migrations
 * (house/no-typeorm-synchronize). TypeORM's `migrationsRun` is always off: it takes no lock.
 * Migrations run only through `runMigrationsLocked` (migration-lock.ts): `openDataSource` for
 * MIGRATE_ON_BOOT, and `db.js migrate`.
 */
export function dataSourceOptions(url: string): DataSourceOptions {
  return {
    type: "postgres",
    url,
    entities: ENTITIES,
    migrations: MIGRATIONS,
    migrationsRun: false,
    migrationsTransactionMode: "each",
    synchronize: false,
    logging: ["error"],
    // A booking holds one connection (the locked case) while a simulator takes a second.
    // Bound the wait for a connection so a burst fails fast instead of hanging (ADR 0020).
    extra: { max: 20, connectionTimeoutMillis: 5_000 },
  };
}

/** A DataSource for scripts (migrate, seed, the TypeORM CLI); the API uses TypeOrmModule. */
export function createDataSource(url: string): DataSource {
  return new DataSource(dataSourceOptions(url));
}

/**
 * Empty the database completely — tables, sequences, functions, triggers, extensions — in
 * the lending schema and the simulators' schema. Development, test and demo resets only.
 */
export async function dropEverything(ds: DataSource): Promise<void> {
  await ds.query("DROP SCHEMA IF EXISTS sim CASCADE");
  await ds.query("DROP SCHEMA public CASCADE");
  await ds.query("CREATE SCHEMA public");
}
