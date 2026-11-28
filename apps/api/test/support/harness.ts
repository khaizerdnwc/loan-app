import { randomUUID } from "node:crypto";
import "reflect-metadata";
import { SEED_TEST_PASSWORD } from "@loan/base";
import { type CaseDetail, CONSENT_TERMS_VERSION, type CreateCaseRequest } from "@loan/core";
import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { DataSource } from "typeorm";
import { configureApp } from "../../src/app";
import { AppModule } from "../../src/app.module";

/** The seeded staff (packages/base/src/seed/seed.ts). */
export const STAFF = {
  paolo: "STF-PAOLO",
  rina: "STF-RINA",
  ben: "STF-BEN",
  marco: "STF-MARCO",
  ella: "STF-ELLA",
  lito: "STF-LITO",
  diane: "STF-DIANE",
  leo: "STF-LEO",
  celia: "STF-CELIA",
  joy: "STF-JOY",
  teo: "STF-TEO",
} as const;
export type Persona = keyof typeof STAFF;

export interface Harness {
  app: INestApplication;
  ds: DataSource;
  /** An HTTP client signed in as a persona (session cookie). */
  as(persona: Persona): Client;
  anonymous(): request.Agent;
  close(): Promise<void>;
}

export interface Client {
  get(path: string): request.Test;
  post(path: string, body?: object): request.Test;
  patch(path: string, body: object): request.Test;
  put(path: string, body: object): request.Test;
}

/**
 * Boot the real app (same module, pipes, filter and guards as production) against the
 * test database, and start each test file from empty lending tables and OK simulators.
 */
export async function startHarness(): Promise<Harness> {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const app = moduleRef.createNestApplication();
  configureApp(app);
  await app.init();
  const ds = app.get(DataSource);
  await resetData(ds);

  // Sign every persona in once; each client then sends its session cookie.
  const cookies = new Map<Persona, string>();
  for (const persona of Object.keys(STAFF) as Persona[]) {
    const res = await request(app.getHttpServer())
      .post("/auth/sign-in")
      .send({ username: persona, password: SEED_TEST_PASSWORD })
      .expect(200);
    const setCookie = ([] as string[]).concat(res.headers["set-cookie"] ?? []);
    const session = setCookie.find((c) => c.startsWith("session="))?.split(";")[0];
    if (!session) throw new Error(`no session cookie for ${persona}`);
    cookies.set(persona, session);
  }

  return {
    app,
    ds,
    as(persona) {
      const server = app.getHttpServer();
      const cookie = cookies.get(persona) as string;
      return {
        get: (path) => request(server).get(path).set("Cookie", cookie),
        post: (path, body) =>
          request(server)
            .post(path)
            .set("Cookie", cookie)
            .send(body ?? {}),
        patch: (path, body) => request(server).patch(path).set("Cookie", cookie).send(body),
        put: (path, body) => request(server).put(path).set("Cookie", cookie).send(body),
      };
    },
    anonymous: () => request.agent(app.getHttpServer()),
    close: async () => {
      await app.close();
    },
  };
}

/**
 * Empty every case table and reset the simulators; staff, applicants and personas stay.
 * One TRUNCATE statement (the child tables reference each other by foreign key), with the
 * insert-only tables' TRUNCATE guards switched off for that transaction (truncateGuarded).
 *
 * The audit log (`audit_event`) is never emptied: its triggers refuse TRUNCATE, so its hash
 * chain keeps growing across test files within a run. global-setup drops and re-migrates the
 * test database at the start of every run, which is what resets it. If a run is killed in
 * the middle of AUD-5 (trigger disabled, an entry edited), the next run's global-setup
 * rebuilds the database; to repair a retained test database by hand, drop and recreate it.
 */
export async function resetData(ds: DataSource): Promise<void> {
  await truncateGuarded(ds, [
    "aml_escalation",
    "consent_record",
    "schedule_line",
    "disbursement",
    "loan_account",
    "booking_request",
    "loan_case",
    "decision_record",
    "activity_event",
    "automation_change",
    "automation_event",
    "reconciliation_run",
    "provider_call",
    "bureau_report_cache",
    "sim.core_account",
    "sim.disbursement",
    "sim.signature",
    "sim.service_mode",
    "sim.document_upload",
    "case_document",
    "staff_notification",
    "notification_delivery",
    "sim.notification",
    "feature_flag_change",
    "intake_draft",
    "intake_batch",
    "document_extraction",
  ]);
  // Automation back to how the migrations leave it: PL live, kill switch off, no external
  // decision engine, no changes.
  await ds.query(`INSERT INTO product_automation (product_code, mode) VALUES ('PL', 'LIVE')
    ON CONFLICT (product_code) DO UPDATE SET mode = 'LIVE', kill_switch = false,
      kill_switch_set_by = NULL, kill_switch_set_at = NULL, external_engine = 'NONE'`);
  // Every module on, as the feature-flag migration leaves them.
  await ds.query(`UPDATE feature_flag SET enabled = true, updated_by = NULL`);
}

/**
 * TRUNCATE tables between tests although the insert-only ones refuse TRUNCATE (migration
 * 1764300009000). Their BEFORE TRUNCATE triggers are disabled, as the table owner, and enabled
 * again in the same transaction, so a failed reset leaves every guard on and no other session
 * ever sees them off (ALTER TABLE holds an exclusive lock until commit). Deleting row by row
 * instead is not possible: the row-level insert-only triggers refuse DELETE too. The guards
 * are found from the catalogue, so a new insert-only table needs no change here.
 */
export async function truncateGuarded(ds: DataSource, tables: string[]): Promise<void> {
  await ds.transaction(async (m) => {
    const guards = (await m.query(
      `SELECT tgrelid::regclass::text AS tbl, tgname AS name FROM pg_trigger
       WHERE NOT tgisinternal AND tgenabled <> 'D' AND (tgtype & 32) = 32
         AND tgrelid = ANY($1::regclass[])`,
      [tables],
    )) as { tbl: string; name: string }[];
    for (const g of guards) await m.query(`ALTER TABLE ${g.tbl} DISABLE TRIGGER "${g.name}"`);
    await m.query(`TRUNCATE ${tables.join(", ")}`);
    for (const g of guards) await m.query(`ALTER TABLE ${g.tbl} ENABLE TRIGGER "${g.name}"`);
  });
}

export async function setMode(h: Harness, service: string, mode: string): Promise<void> {
  await h.as("leo").put(`/simulation/services/${service}`, { mode }).expect(200);
}

/** The applicant's full consent for the current terms (PRD INT-006). */
export const FULL_CONSENT = {
  creditBureauCheck: true,
  dataProcessing: true,
  termsVersion: CONSENT_TERMS_VERSION,
} as const;

/**
 * A new synthetic applicant with the same profile as a seeded one (and the same simulated
 * bureau and screening answers), so a test gets its own applicant: one applicant may have only
 * one open application per product (INT-007). The name stays the same.
 *
 * So the twin has the seeded applicant's identity (name, birth date, ID ending), and for the
 * rest of the run that identity matches "many" (WI-2): a capture of it is refused naming each.
 * A test that needs it to match exactly one customer must use an identity nobody twins
 * (Lorna Abad's, for example).
 */
export async function twin(h: Harness, seededId: string): Promise<string> {
  const id = `${seededId}-${randomUUID().slice(0, 8)}`;
  await h.ds.query(
    `INSERT INTO applicant SELECT (jsonb_populate_record(NULL::applicant, to_jsonb(a) || jsonb_build_object('id', $2::text))).*
     FROM applicant a WHERE a.id = $1`,
    [seededId, id],
  );
  await h.ds.query(
    `INSERT INTO sim.persona_profile (applicant_id, bureau, screening, fraud)
     SELECT $2, bureau, screening, fraud FROM sim.persona_profile WHERE applicant_id = $1`,
    [seededId, id],
  );
  await h.ds.query(
    `INSERT INTO sim.document_profile (applicant_id, payload)
     SELECT $2, payload FROM sim.document_profile WHERE applicant_id = $1`,
    [seededId, id],
  );
  return id;
}

/**
 * Create and submit an application as the loan officer, with the applicant's consent. Each
 * call uses a twin of the named applicant unless `sameApplicant` is set.
 */
export async function submitCase(
  h: Harness,
  body: Partial<CreateCaseRequest> & { applicantId: string },
  options: { sameApplicant?: boolean } = {},
): Promise<CaseDetail> {
  const applicantId = options.sameApplicant ? body.applicantId : await twin(h, body.applicantId);
  const res = await h
    .as("paolo")
    .post("/cases", {
      amount: "150000.00",
      tenorMonths: 24,
      purpose: "Home improvement",
      submit: true,
      consent: FULL_CONSENT,
      ...body,
      applicantId,
    })
    .expect(201);
  return res.body as CaseDetail;
}

/** Take an approved case (status OFFER) through signing and the maker step. */
export async function readyForChecker(
  h: Harness,
  id: string,
  maker: Persona = "marco",
): Promise<CaseDetail> {
  await h.as("marco").post(`/cases/${id}/sign`).expect(200);
  const res = await h.as(maker).post(`/cases/${id}/booking`).expect(200);
  return res.body as CaseDetail;
}

export async function count(ds: DataSource, sql: string, params: unknown[] = []): Promise<number> {
  const [row] = (await ds.query(sql, params)) as [{ n: string }];
  return Number(row.n);
}
