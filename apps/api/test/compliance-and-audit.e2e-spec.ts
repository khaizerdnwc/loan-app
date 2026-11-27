import { AuditService, SEED_TEST_PASSWORD } from "@loan/base";
import type {
  AmlEscalationView,
  AuditChainVerification,
  AuditLogPage,
  CaseDetail,
} from "@loan/core";
import request from "supertest";
import {
  count,
  FULL_CONSENT,
  type Harness,
  readyForChecker,
  setMode,
  startHarness,
  submitCase,
  twin,
} from "./support/harness";

let h: Harness;
beforeAll(async () => {
  h = await startHarness();
});
afterAll(async () => {
  await h.close();
});
afterEach(async () => {
  await h.ds.query("TRUNCATE sim.service_mode");
});

const escalationsFor = (caseId: string) =>
  h.ds.query(
    "SELECT id, stage, status, outcome FROM aml_escalation WHERE case_id = $1 ORDER BY opened_at",
    [caseId],
  ) as Promise<{ id: string; stage: string; status: string; outcome: string | null }[]>;
const activityCount = (caseId: string) =>
  count(h.ds, "SELECT count(*) AS n FROM activity_event WHERE case_id = $1", [caseId]);
const auditCount = () => count(h.ds, "SELECT count(*) AS n FROM audit_event");
const accounts = (caseId: string) =>
  count(h.ds, "SELECT count(*) AS n FROM loan_account WHERE case_id = $1", [caseId]);
const coreAccounts = (caseId: string) =>
  count(h.ds, "SELECT count(*) AS n FROM sim.core_account WHERE application_id = $1", [caseId]);
const attempts = (caseId: string) =>
  count(h.ds, "SELECT attempts AS n FROM booking_request WHERE case_id = $1", [caseId]);

/** The case history as a loan officer reads it, as one string. */
async function officerHistory(caseId: string): Promise<string> {
  return JSON.stringify((await h.as("paolo").get(`/cases/${caseId}/activity`).expect(200)).body);
}

async function auditFor(query: string, persona: "diane" | "leo" = "diane") {
  return (await h.as(persona).get(`/audit/events?${query}`).expect(200)).body as AuditLogPage;
}

async function verify(persona: "diane" | "leo" = "diane"): Promise<AuditChainVerification> {
  return (await h.as(persona).get("/audit/verify").expect(200)).body as AuditChainVerification;
}

/** Today's business date (Philippines, UTC+8), as the API reads date filters. */
function businessDate(offsetDays = 0): string {
  return new Date(Date.now() + 8 * 3_600_000 + offsetDays * 86_400_000).toISOString().slice(0, 10);
}

async function escalationFor(caseId: string): Promise<AmlEscalationView> {
  const list = (await h.as("diane").get("/compliance/escalations?view=all").expect(200))
    .body as AmlEscalationView[];
  const found = list.find((e) => e.caseId === caseId);
  if (!found) throw new Error(`no escalation for ${caseId}`);
  return found;
}

/** Dario (clear at application, listed before disbursement) refused at the checker step. */
async function heldBooking(): Promise<{ c: CaseDetail; escalation: AmlEscalationView }> {
  const c = await submitCase(h, { applicantId: "APL-DARIO", amount: "60000.00", tenorMonths: 12 });
  expect(c.status).toBe("OFFER");
  await readyForChecker(h, c.id);
  const res = await h.as("ella").post(`/cases/${c.id}/booking/approve`).expect(409);
  expect(res.body.code).toBe("SCREENING_MATCH");
  expect(res.body.detail).toMatch(/Nothing was booked/);
  // The checker is not told which list matched.
  expect(res.body.detail).not.toMatch(/watchlist/i);
  return { c, escalation: await escalationFor(c.id) };
}

describe("AML escalation to Compliance (PRD CMP-005, F6)", () => {
  it("CMP-1 a sanctions knockout opens one escalation that Compliance lists and opens", async () => {
    const c = await submitCase(h, { applicantId: "APL-RAMON", amount: "50000.00" });
    expect(c.status).toBe("DECLINED");
    expect(await escalationsFor(c.id)).toEqual([
      expect.objectContaining({ stage: "ONBOARDING", status: "OPEN" }),
    ]);

    const open = (await h.as("diane").get("/compliance/escalations").expect(200))
      .body as AmlEscalationView[];
    const listed = open.find((e) => e.caseId === c.id);
    expect(listed).toMatchObject({
      caseReference: c.reference,
      applicantName: "Ramon Cruz",
      stage: "ONBOARDING",
      status: "OPEN",
      providerMode: "SIMULATED",
      openedByName: "Decision engine",
    });
    const detail = (await h.as("diane").get(`/compliance/escalations/${listed?.id}`).expect(200))
      .body as AmlEscalationView;
    expect(detail.effect).toMatch(/declined/);

    const history = (await h.as("diane").get(`/cases/${c.id}/activity`).expect(200)).body as {
      action: string;
    }[];
    expect(history.map((e) => e.action)).toContain("AML_ESCALATION_OPENED");

    // An auto-approved applicant opens none.
    const maria = await submitCase(h, { applicantId: "APL-MARIA", amount: "60000.00" });
    expect(await escalationsFor(maria.id)).toEqual([]);
  });

  it("CMP-12 the knockout, its escalation, the case events and their audit entries commit together or not at all", async () => {
    const applicantId = await twin(h, "APL-RAMON");
    const draft = await h
      .as("paolo")
      .post("/cases", {
        applicantId,
        amount: "50000.00",
        tenorMonths: 12,
        purpose: "Home improvement",
        submit: false,
        consent: FULL_CONSENT,
      })
      .expect(201);
    const id = draft.body.id as string;
    const eventsBefore = await activityCount(id);
    const logged = await auditCount();

    // The audit store fails on the last write of the submit transaction: the escalation's entry.
    const audit = h.app.get(AuditService);
    const real = audit.append.bind(audit);
    const spy = jest
      .spyOn(audit, "append")
      .mockImplementation((m, input) =>
        input.action === "AML_ESCALATION_OPENED"
          ? Promise.reject(new Error("simulated audit store failure"))
          : real(m, input),
      );
    try {
      await h.as("paolo").post(`/cases/${id}/submit`).expect(500);
    } finally {
      spy.mockRestore();
    }

    expect((await h.as("paolo").get(`/cases/${id}`).expect(200)).body.status).toBe("DRAFT");
    expect(await escalationsFor(id)).toEqual([]);
    expect(
      await count(h.ds, "SELECT count(*) AS n FROM decision_record WHERE case_id = $1", [id]),
    ).toBe(0);
    expect(await activityCount(id)).toBe(eventsBefore);
    expect(await auditCount()).toBe(logged);
    expect((await verify()).intact).toBe(true);

    // With the store back, the same submission commits everything.
    await h.as("paolo").post(`/cases/${id}/submit`).expect(200);
    expect(await escalationsFor(id)).toHaveLength(1);
    expect(
      await count(h.ds, "SELECT count(*) AS n FROM audit_event WHERE case_id = $1", [id]),
    ).toBe(await activityCount(id));
  });

  it("CMP-2 Compliance acknowledges, then closes with notes; refusals change nothing", async () => {
    const c = await submitCase(h, { applicantId: "APL-RAMON", amount: "50000.00" });
    const e = await escalationFor(c.id);

    const acked = (
      await h.as("diane").post(`/compliance/escalations/${e.id}/acknowledge`).expect(200)
    ).body as AmlEscalationView;
    expect(acked).toMatchObject({ status: "ACKNOWLEDGED", acknowledgedByName: "Diane Yu" });
    const again = await h
      .as("diane")
      .post(`/compliance/escalations/${e.id}/acknowledge`)
      .expect(409);
    expect(again.body.code).toBe("INVALID_STATE_TRANSITION");

    const events = await activityCount(c.id);
    const logged = await auditCount();
    const noNotes = await h
      .as("diane")
      .post(`/compliance/escalations/${e.id}/close`, { outcome: "CONFIRMED_MATCH", notes: "  " })
      .expect(400);
    expect(noNotes.body.errors).toEqual([expect.objectContaining({ field: "notes" })]);
    await h
      .as("diane")
      .post(`/compliance/escalations/${e.id}/close`, { outcome: "MAYBE", notes: "x" })
      .expect(400);
    expect((await escalationsFor(c.id))[0]?.status).toBe("ACKNOWLEDGED");
    expect(await activityCount(c.id)).toBe(events);
    expect(await auditCount()).toBe(logged);

    const closed = (
      await h
        .as("diane")
        .post(`/compliance/escalations/${e.id}/close`, {
          outcome: "CONFIRMED_MATCH",
          notes: "Name, birth date and ID match the simulated list entry.",
        })
        .expect(200)
    ).body as AmlEscalationView;
    expect(closed).toMatchObject({
      status: "CLOSED",
      outcome: "CONFIRMED_MATCH",
      closedByName: "Diane Yu",
      notes: "Name, birth date and ID match the simulated list entry.",
    });
    const afterClose = await auditCount();
    await h
      .as("diane")
      .post(`/compliance/escalations/${e.id}/close`, { outcome: "FALSE_POSITIVE", notes: "x" })
      .expect(409);
    expect(await auditCount()).toBe(afterClose);

    // No tipping-off: the case history a loan officer reads has no notes and no outcome
    // reasoning; the audit log (Compliance and admin only) keeps them.
    const officer = await officerHistory(c.id);
    expect(officer).toContain("AML review closed; the decline stands.");
    expect(officer).not.toContain("simulated list entry");
    expect(officer).not.toMatch(/CONFIRMED_MATCH|match confirmed/);
    const logged2 = await auditFor(`case=${c.reference}&action=AML_ESCALATION_CLOSED`);
    expect(logged2.items[0]?.details).toMatchObject({
      outcome: "CONFIRMED_MATCH",
      notes: "Name, birth date and ID match the simulated list entry.",
    });
    const open = (await h.as("diane").get("/compliance/escalations").expect(200))
      .body as AmlEscalationView[];
    expect(open.some((x) => x.id === e.id)).toBe(false);
    const history = (await h.as("diane").get(`/cases/${c.id}/activity`).expect(200)).body as {
      action: string;
    }[];
    expect(history.map((x) => x.action)).toEqual(
      expect.arrayContaining(["AML_ESCALATION_ACKNOWLEDGED", "AML_ESCALATION_CLOSED"]),
    );
    // The decision stays a decline.
    expect((await h.as("diane").get(`/cases/${c.id}`).expect(200)).body.status).toBe("DECLINED");
  });

  it("CMP-3 only Compliance works escalations (403 for every other role, 401 signed out)", async () => {
    const c = await submitCase(h, { applicantId: "APL-RAMON", amount: "50000.00" });
    const e = await escalationFor(c.id);
    for (const persona of ["paolo", "rina", "marco", "ella", "leo"] as const) {
      await h.as(persona).get("/compliance/escalations").expect(403);
      await h.as(persona).get(`/compliance/escalations/${e.id}`).expect(403);
      await h.as(persona).post(`/compliance/escalations/${e.id}/acknowledge`).expect(403);
      await h
        .as(persona)
        .post(`/compliance/escalations/${e.id}/close`, { outcome: "FALSE_POSITIVE", notes: "x" })
        .expect(403);
    }
    await h.anonymous().get("/compliance/escalations").expect(401);
    expect((await escalationsFor(c.id))[0]?.status).toBe("OPEN");
  });

  it("CMP-4 a match when screening again before disbursement holds the booking and escalates", async () => {
    const { c, escalation } = await heldBooking();
    expect(escalation).toMatchObject({
      stage: "PRE_DISBURSEMENT",
      status: "OPEN",
      matchedList: "Simulated watchlist (updated list)",
      openedByName: "Ella Reyes",
    });
    const held = (await h.as("lito").get(`/cases/${c.id}`).expect(200)).body as CaseDetail;
    expect(held.status).toBe("BOOKING_FAILED");
    expect(held.allowedActions).toContainEqual(
      expect.objectContaining({
        action: "RETRY_BOOKING",
        enabled: false,
        blockedBy: "COMPLIANCE_HOLD",
      }),
    );
    expect(await accounts(c.id)).toBe(0);
    expect(await coreAccounts(c.id)).toBe(0);

    // A retry while Compliance has it is refused before any provider call; nothing is written.
    const tries = await attempts(c.id);
    const events = await activityCount(c.id);
    const logged = await auditCount();
    const retry = await h.as("lito").post(`/cases/${c.id}/booking/approve`).expect(409);
    expect(retry.body.code).toBe("COMPLIANCE_HOLD");
    expect(await attempts(c.id)).toBe(tries);
    expect(await activityCount(c.id)).toBe(events);
    expect(await auditCount()).toBe(logged);
    expect(await escalationsFor(c.id)).toHaveLength(1);

    // The list that matched stays with Compliance: not in the case history, but in the log.
    const officer = await officerHistory(c.id);
    expect(officer).toContain("AML review opened: the booking is held for Compliance.");
    expect(officer).not.toMatch(/watchlist/i);
    const logged2 = await auditFor(`case=${c.reference}&action=AML_ESCALATION_OPENED`);
    expect(logged2.items[0]?.details).toMatchObject({
      matchedList: "Simulated watchlist (updated list)",
      priorAttempts: 0,
    });
  });

  it("CMP-5 cleared as a false positive, the retry books exactly once", async () => {
    const { c, escalation } = await heldBooking();
    await h
      .as("diane")
      .post(`/compliance/escalations/${escalation.id}/close`, {
        outcome: "FALSE_POSITIVE",
        notes: "Different birth date and ID; not the listed person.",
      })
      .expect(200);
    const booked = (await h.as("lito").post(`/cases/${c.id}/booking/approve`).expect(200))
      .body as CaseDetail;
    expect(booked.status).toBe("DISBURSED");
    expect(await accounts(c.id)).toBe(1);
    expect(await coreAccounts(c.id)).toBe(1);
    const [event] = (await h.ds.query(
      "SELECT details FROM activity_event WHERE case_id = $1 AND action = 'BOOKING_RETRIED'",
      [c.id],
    )) as { details: { preDisbursementScreening: { clearedByEscalationId: string } } }[];
    expect(event?.details.preDisbursementScreening.clearedByEscalationId).toBe(escalation.id);
  });

  it("CMP-6 a confirmed match keeps the booking blocked", async () => {
    const { c, escalation } = await heldBooking();
    await h
      .as("diane")
      .post(`/compliance/escalations/${escalation.id}/close`, {
        outcome: "CONFIRMED_MATCH",
        notes: "The applicant is the listed person.",
      })
      .expect(200);
    const res = await h.as("lito").post(`/cases/${c.id}/booking/approve`).expect(409);
    expect(res.body.code).toBe("COMPLIANCE_HOLD");
    expect(res.body.detail).toMatch(/cannot be booked/);
    expect((await h.as("lito").get(`/cases/${c.id}`).expect(200)).body.status).toBe(
      "BOOKING_FAILED",
    );
    expect(await accounts(c.id)).toBe(0);
    expect(await coreAccounts(c.id)).toBe(0);
  });

  it("CMP-7 screening unavailable before disbursement holds the booking (503), never declines", async () => {
    const c = await submitCase(h, {
      applicantId: "APL-MARIA",
      amount: "60000.00",
      tenorMonths: 12,
    });
    await readyForChecker(h, c.id);
    await setMode(h, "KYC_AML", "OUTAGE");
    const res = await h.as("ella").post(`/cases/${c.id}/booking/approve`).expect(503);
    expect(res.body.code).toBe("PROVIDER_UNAVAILABLE");
    expect(res.body.detail).toMatch(/KYC\/AML screening is unavailable/);
    const held = (await h.as("ella").get(`/cases/${c.id}`).expect(200)).body as CaseDetail;
    expect(held.status).toBe("BOOKING_FAILED");
    expect(await accounts(c.id)).toBe(0);
    expect(await coreAccounts(c.id)).toBe(0);
    expect(await escalationsFor(c.id)).toEqual([]);

    await setMode(h, "KYC_AML", "OK");
    const booked = (await h.as("lito").post(`/cases/${c.id}/booking/approve`).expect(200))
      .body as CaseDetail;
    expect(booked.status).toBe("DISBURSED");
    expect(await accounts(c.id)).toBe(1);
  });

  it("CMP-8 a clear screening before disbursement is recorded with the booking", async () => {
    const c = await submitCase(h, {
      applicantId: "APL-MARIA",
      amount: "60000.00",
      tenorMonths: 12,
    });
    await readyForChecker(h, c.id);
    await h.as("ella").post(`/cases/${c.id}/booking/approve`).expect(200);
    const [event] = (await h.ds.query(
      "SELECT details FROM activity_event WHERE case_id = $1 AND action = 'BOOKING_APPROVED'",
      [c.id],
    )) as { details: { preDisbursementScreening: Record<string, unknown> } }[];
    expect(event?.details.preDisbursementScreening).toMatchObject({
      providerMode: "SIMULATED",
      clearedByEscalationId: null,
    });
  });

  it("CMP-9 two checkers hitting the same match at once open one escalation", async () => {
    const c = await submitCase(h, {
      applicantId: "APL-DARIO",
      amount: "60000.00",
      tenorMonths: 12,
    });
    await readyForChecker(h, c.id);
    const results = await Promise.all([
      h.as("ella").post(`/cases/${c.id}/booking/approve`),
      h.as("ella").post(`/cases/${c.id}/booking/approve`),
    ]);
    expect(results.map((r) => r.status)).toEqual([409, 409]);
    // The first screens and matches; the second either matched too (it screened before the
    // first committed the hold) or met the hold. Each match counts one failed attempt.
    const codes = results.map((r) => r.body.code as string);
    expect(codes).toContain("SCREENING_MATCH");
    expect(codes.every((x) => x === "SCREENING_MATCH" || x === "COMPLIANCE_HOLD")).toBe(true);
    expect(await attempts(c.id)).toBe(codes.filter((x) => x === "SCREENING_MATCH").length);
    expect(await escalationsFor(c.id)).toHaveLength(1);
    expect(await accounts(c.id)).toBe(0);
  });

  it("CMP-11 a match after a lost reply says an earlier attempt may have reached core, and records it", async () => {
    const c = await submitCase(h, {
      applicantId: "APL-MARIA",
      amount: "60000.00",
      tenorMonths: 12,
    });
    await readyForChecker(h, c.id);
    // Attempt 1: screening clear, core books it but the reply is lost (ADR 0020).
    await setMode(h, "CORE_BANKING", "LOST_REPLY");
    await h.as("ella").post(`/cases/${c.id}/booking/approve`).expect(503);
    expect(await coreAccounts(c.id)).toBe(1);
    await setMode(h, "CORE_BANKING", "OK");
    // The simulated list then adds this applicant; attempt 2 matches.
    await h.ds.query(
      `UPDATE sim.persona_profile SET screening = screening || '{"listedBeforeDisbursement": {"matchedList": "Simulated watchlist (updated list)"}}'::jsonb
       WHERE applicant_id = (SELECT applicant_id FROM loan_case WHERE id = $1)`,
      [c.id],
    );
    const res = await h.as("lito").post(`/cases/${c.id}/booking/approve`).expect(409);
    expect(res.body.code).toBe("SCREENING_MATCH");
    expect(res.body.detail).not.toMatch(/Nothing was booked or paid out/);
    expect(res.body.detail).toMatch(/earlier attempt may already have reached core banking/);
    const e = await escalationFor(c.id);
    expect(e).toMatchObject({ stage: "PRE_DISBURSEMENT", priorBookingAttempts: 1 });
    expect(e.effect).toMatch(/may already exist/);
    expect(await accounts(c.id)).toBe(0);
    expect(await attempts(c.id)).toBe(2);
  });
});

describe("tamper-evident audit log (PRD PLT-004, CMP-010)", () => {
  it("AUD-1 sign-ins are logged, success and failure, and no password ever is", async () => {
    const wrong = "Wrong-Pa55word!";
    const typedName = "Hunter2-Typed-As-Name";
    await h
      .anonymous()
      .post("/auth/sign-in")
      .send({ username: "paolo", password: wrong })
      .expect(401);
    await h
      .anonymous()
      .post("/auth/sign-in")
      .send({ username: typedName, password: wrong })
      .expect(401);
    await h
      .anonymous()
      .post("/auth/sign-in")
      .send({ username: "rina", password: SEED_TEST_PASSWORD })
      .expect(200);

    const failed = await auditFor("action=SIGN_IN_FAILED&limit=5");
    expect(failed.items[0]).toMatchObject({
      actorId: "UNKNOWN",
      actorName: "Unknown username",
      summary: "Sign-in refused: no such account.",
    });
    expect(failed.items[1]).toMatchObject({
      actorId: "STF-PAOLO",
      summary: "Sign-in refused: wrong password.",
    });
    const ok = await auditFor("action=SIGN_IN_SUCCEEDED&actor=STF-RINA&limit=1");
    expect(ok.items[0]).toMatchObject({ actorName: "Rina Aquino", actorRole: "APPROVER" });

    for (const secret of [wrong, SEED_TEST_PASSWORD, typedName]) {
      expect(
        await count(
          h.ds,
          "SELECT count(*) AS n FROM audit_event a WHERE row_to_json(a)::text LIKE $1",
          [`%${secret}%`],
        ),
      ).toBe(0);
    }

    const me = request.agent(h.app.getHttpServer());
    await me
      .post("/auth/sign-in")
      .send({ username: "marco", password: SEED_TEST_PASSWORD })
      .expect(200);
    await me.post("/auth/logout").expect(204);
    const out = await auditFor("action=SIGNED_OUT&actor=STF-MARCO&limit=1");
    expect(out.items[0]?.actorName).toBe("Marco Bautista");
  });

  it("AUD-2 simulation mode changes are logged with who, the service, and before and after", async () => {
    await setMode(h, "CREDIT_BUREAU", "TIMEOUT");
    await setMode(h, "CREDIT_BUREAU", "OK");
    const page = await auditFor("action=SIMULATION_MODE_CHANGED&limit=2");
    expect(page.items.map((e) => e.details)).toEqual([
      expect.objectContaining({ service: "CREDIT_BUREAU", from: "TIMEOUT", to: "OK" }),
      expect.objectContaining({ service: "CREDIT_BUREAU", from: "OK", to: "TIMEOUT" }),
    ]);
    expect(page.items[0]).toMatchObject({ actorId: "STF-LEO", actorRole: "ADMIN" });
  });

  it("AUD-3 every case activity event (consent included) is in the log, in its transaction", async () => {
    const c = await submitCase(h, {
      applicantId: "APL-JOEL",
      amount: "200000.00",
      tenorMonths: 36,
    });
    const page = await auditFor(`case=${c.reference}&limit=50`);
    expect(page.items.map((e) => e.action).reverse()).toEqual([
      "CASE_CREATED",
      "CONSENT_RECORDED",
      "CASE_SUBMITTED",
      "DECISION_MADE",
    ]);
    expect(page.items.every((e) => e.caseId === c.id)).toBe(true);
    expect(page.items.find((e) => e.action === "DECISION_MADE")).toMatchObject({
      actorId: "SYSTEM",
      details: expect.objectContaining({ fromStatus: "DRAFT", toStatus: "REVIEW" }),
    });
    expect(
      await count(h.ds, "SELECT count(*) AS n FROM audit_event WHERE case_id = $1", [c.id]),
    ).toBe(await activityCount(c.id));

    // A refused change writes neither history nor audit.
    const before = await auditCount();
    await h.as("paolo").post(`/cases/${c.id}/submit`).expect(409);
    expect(await auditCount()).toBe(before);
  });

  it("AUD-4 the database refuses UPDATE, DELETE and TRUNCATE on the log", async () => {
    await expect(h.ds.query("UPDATE audit_event SET summary = 'x' WHERE seq = 1")).rejects.toThrow(
      /insert-only/,
    );
    await expect(h.ds.query("DELETE FROM audit_event WHERE seq = 1")).rejects.toThrow(
      /insert-only/,
    );
    await expect(h.ds.query("TRUNCATE audit_event")).rejects.toThrow(/insert-only/);
    expect(await count(h.ds, "SELECT count(*) AS n FROM audit_event WHERE seq = 1")).toBe(1);
  });

  it("AUD-5 verify recomputes the chain and finds a changed or removed entry", async () => {
    const intact = await verify();
    expect(intact).toMatchObject({ intact: true, firstBrokenSeq: null });
    expect(intact.checked).toBe(await auditCount());
    expect(intact.headSeq).toBe(intact.checked);

    // Tamper the only way left, as the table's owner: switch the trigger off, edit, switch on.
    const [three] = (await h.ds.query("SELECT summary FROM audit_event WHERE seq = 3")) as {
      summary: string;
    }[];
    const [four] = (await h.ds.query(
      "SELECT to_jsonb(a) AS row FROM audit_event a WHERE seq = 4",
    )) as { row: Record<string, unknown> }[];
    await h.ds.query("ALTER TABLE audit_event DISABLE TRIGGER audit_event_insert_only");
    try {
      await h.ds.query("UPDATE audit_event SET summary = summary || ' (edited)' WHERE seq = 3");
      const edited = await verify("leo");
      expect(edited).toMatchObject({ intact: false, firstBrokenSeq: 3 });
      expect(edited.problem).toMatch(/changed/);

      await h.ds.query("UPDATE audit_event SET summary = $1 WHERE seq = 3", [three?.summary]);
      await h.ds.query("DELETE FROM audit_event WHERE seq = 4");
      const removed = await verify();
      expect(removed).toMatchObject({ intact: false, firstBrokenSeq: 4 });
      expect(removed.problem).toMatch(/missing/);
    } finally {
      await h.ds.query(
        `INSERT INTO audit_event SELECT * FROM jsonb_populate_record(NULL::audit_event, $1::jsonb)
         ON CONFLICT (seq) DO NOTHING`,
        [JSON.stringify(four?.row)],
      );
      await h.ds.query("ALTER TABLE audit_event ENABLE TRIGGER audit_event_insert_only");
    }
    expect((await verify()).intact).toBe(true);
  });

  it("AUD-6 the log filters by actor, action, date range and case, newest first, in pages", async () => {
    const c = await submitCase(h, { applicantId: "APL-MARIA", amount: "60000.00" });
    const byCase = await auditFor(`case=${c.reference.toLowerCase()}`);
    expect(byCase.items.length).toBeGreaterThan(0);
    expect(byCase.items.every((e) => e.caseReference === c.reference)).toBe(true);

    const byName = await auditFor("actor=paolo&action=CASE_CREATED&limit=3");
    expect(byName.items.length).toBeGreaterThan(0);
    expect(
      byName.items.every((e) => e.actorName === "Paolo Tan" && e.action === "CASE_CREATED"),
    ).toBe(true);

    const today = await auditFor(`from=${businessDate()}&to=${businessDate()}&limit=5`);
    expect(today.items).toHaveLength(5);
    // Empty because global-setup rebuilds the test database every run; a retained test
    // database spanning midnight (UTC+8) would hold yesterday's entries.
    const yesterday = await auditFor(`from=${businessDate(-1)}&to=${businessDate(-1)}`);
    expect(yesterday.items).toEqual([]);

    const first = await auditFor("limit=2");
    expect(first.items[0]?.seq).toBeGreaterThan(first.items[1]?.seq ?? Number.POSITIVE_INFINITY);
    expect(first.nextBefore).toBe(first.items[1]?.seq);
    const next = await auditFor(`limit=2&before=${first.nextBefore}`);
    expect(next.items[0]?.seq).toBe((first.items[1]?.seq ?? 0) - 1);

    const actions = (await h.as("diane").get("/audit/actions").expect(200)).body as string[];
    expect(actions).toEqual(expect.arrayContaining(["CASE_CREATED", "SIGN_IN_SUCCEEDED"]));

    const backwards = await h
      .as("diane")
      .get(`/audit/events?from=${businessDate()}&to=${businessDate(-1)}`)
      .expect(400);
    expect(backwards.body.errors).toEqual([expect.objectContaining({ field: "to" })]);
    await h.as("diane").get("/audit/events?from=2026-02-31").expect(400);
    await h.as("diane").get("/audit/events?action=drop%20table").expect(400);
    await h.as("diane").get("/audit/events?unknown=1").expect(400);
  });

  it("AUD-7 compliance and the administrator read the log; the administrator sees no case", async () => {
    const c = await submitCase(h, { applicantId: "APL-MARIA", amount: "60000.00" });
    for (const persona of ["paolo", "rina", "marco", "ella"] as const) {
      await h.as(persona).get("/audit/events").expect(403);
      await h.as(persona).get("/audit/actions").expect(403);
      await h.as(persona).get("/audit/verify").expect(403);
    }
    await h.anonymous().get("/audit/events").expect(401);
    await h.anonymous().get("/audit/actions").expect(401);
    await h.anonymous().get("/audit/verify").expect(401);
    expect((await h.as("leo").get("/audit/actions").expect(200)).body).toEqual(
      expect.arrayContaining(["CASE_CREATED"]),
    );

    const asCompliance = await auditFor(`case=${c.reference}`);
    expect(asCompliance.items[0]?.summary).toEqual(expect.any(String));
    expect(asCompliance.items[0]).toMatchObject({ caseReference: c.reference, caseHidden: false });

    // The administrator cannot open cases: no case filter, and case entries come without the
    // case, its summary or details.
    const byCase = await h.as("leo").get(`/audit/events?case=${c.reference}`).expect(403);
    expect(byCase.body.code).toBe("FORBIDDEN_ROLE");
    const asAdmin = await auditFor("action=CASE_CREATED&limit=5", "leo");
    expect(asAdmin.items.length).toBeGreaterThan(0);
    for (const e of asAdmin.items) {
      expect(e).toMatchObject({
        caseId: null,
        caseReference: null,
        caseHidden: true,
        summary: null,
        details: null,
      });
    }
    expect(JSON.stringify(asAdmin)).not.toContain(c.reference);
    const signIns = await auditFor("action=SIGN_IN_SUCCEEDED&limit=1", "leo");
    expect(signIns.items[0]).toMatchObject({ summary: "Signed in.", caseHidden: false });
  });

  it("AUD-8 entries written at once still form one unbroken chain", async () => {
    const before = await auditCount();
    await Promise.all(
      Array.from({ length: 12 }, (_, i) =>
        h
          .anonymous()
          .post("/auth/sign-in")
          .send({ username: i % 2 ? "paolo" : "rina", password: SEED_TEST_PASSWORD })
          .expect(200),
      ),
    );
    expect(await auditCount()).toBe(before + 12);
    expect(await verify()).toMatchObject({ intact: true, checked: before + 12 });
  });
});
