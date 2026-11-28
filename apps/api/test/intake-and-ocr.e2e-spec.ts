import { CasesRepository, IntakeRepository } from "@loan/base";
import { DOCUMENT_EXTRACTION, type DocumentExtraction } from "@loan/contracts";
import type {
  ActivityView,
  CaseDetail,
  CaseExtractionsView,
  DecisionRecordView,
  IntakeDraftView,
  IntakeUploadView,
} from "@loan/core";
import {
  count,
  FULL_CONSENT,
  type Harness,
  resetData,
  setMode,
  startHarness,
  submitCase,
} from "./support/harness";

let h: Harness;
beforeAll(async () => {
  h = await startHarness();
});
afterAll(async () => {
  await h.close();
});
afterEach(async () => {
  jest.restoreAllMocks();
  await h.ds.query("TRUNCATE sim.service_mode");
  // Each test starts with no cases and no intake drafts: confirm tests leave open cases for the
  // synthetic files' applicants, and the same file may be uploaded again.
  await resetData(h.ds);
});

const upload = (source: string) => h.as("paolo").post("/intake/uploads", { source });
const confirm = (id: string, body: object) =>
  h.as("paolo").post(`/intake/drafts/${id}/confirm`, body);
const discard = (id: string, body: object) =>
  h.as("paolo").post(`/intake/drafts/${id}/discard`, body);

/** Everything intake writes: refusals must leave every count as it was. */
const intakeState = async () => ({
  batches: await count(h.ds, "SELECT count(*) AS n FROM intake_batch"),
  drafts: await h.ds.query(
    "SELECT id, status, case_id, version FROM intake_draft ORDER BY fingerprint, row_number",
  ),
  cases: await count(h.ds, "SELECT count(*) AS n FROM loan_case"),
  events: await count(h.ds, "SELECT count(*) AS n FROM activity_event"),
  audit: await count(
    h.ds,
    "SELECT count(*) AS n FROM audit_event WHERE action LIKE 'INTAKE_%' OR action = 'CASE_CREATED'",
  ),
});

async function spreadsheet(): Promise<IntakeUploadView> {
  return (await upload("PARTNER_SPREADSHEET").expect(201)).body as IntakeUploadView;
}

const row = (u: IntakeUploadView, name: string) =>
  u.drafts.find((d) => d.extracted.fullName === name) as IntakeDraftView;

async function activity(id: string): Promise<ActivityView[]> {
  return (await h.as("diane").get(`/cases/${id}/activity`).expect(200)).body as ActivityView[];
}

describe("email and file intake (INT-1..INT-4, PRD INT-010, F4)", () => {
  it("INT-1 a partner spreadsheet becomes three drafts for review, matched, flagged, labelled simulated; no application is created", async () => {
    const before = await intakeState();
    const u = await spreadsheet();
    expect(u).toMatchObject({
      source: "PARTNER_SPREADSHEET",
      fileName: "Cordillera Foods HR – salary loan requests Nov 2026.xlsx",
      rowCount: 3,
      flaggedCount: 1,
      providerMode: "SIMULATED",
    });
    expect(u.reference).toMatch(/^OCR-B-[0-9A-F]{8}$/);
    expect(row(u, "Ramil Ocampo")).toMatchObject({
      rowNumber: 2,
      sourceDetail: "Partner spreadsheet, row 2",
      extracted: { amount: "50000.00", tenorMonths: 12, declaredMonthlyIncome: "32000.00" },
      matchedApplicant: { id: "APL-RAMIL", fullName: "Ramil Ocampo" },
      flags: [],
      status: "PENDING_REVIEW",
      case: null,
      uploadedByName: "Paolo Tan",
      actions: ["CONFIRM", "DISCARD"],
    });
    expect(row(u, "Elmer Santos")).toMatchObject({
      extracted: { governmentIdLast4: null },
      matchedApplicant: null,
      flags: ["GOVERNMENT_ID_MISSING"],
    });
    const after = await intakeState();
    expect(after.batches).toBe(before.batches + 1);
    expect(after.drafts).toHaveLength(3);
    // Drafts for review only: nothing is captured or submitted.
    expect(after.cases).toBe(before.cases);
    expect(after.events).toBe(before.events);
    const [entry] = await h.ds.query(
      "SELECT actor_id, summary FROM audit_event WHERE action = 'INTAKE_UPLOADED' ORDER BY seq DESC LIMIT 1",
    );
    expect(entry.actor_id).toBe("STF-PAOLO");
    expect(entry.summary).toContain("OCR extracted 3 drafts for review (simulated)");
    expect(entry.summary).toContain(u.reference);
    expect(entry.summary).not.toContain("Cordillera");

    const pending = (await h.as("paolo").get("/intake/drafts").expect(200))
      .body as IntakeDraftView[];
    expect(pending.map((d) => d.extracted.fullName)).toEqual([
      "Ramil Ocampo",
      "Joy Fernandez",
      "Elmer Santos",
    ]);
  });

  it("INT-1 the email bundle's draft carries the payslip income OCR read, with no mismatch flag", async () => {
    const u = (await upload("EMAIL_BUNDLE").expect(201)).body as IntakeUploadView;
    expect(u.drafts).toHaveLength(1);
    expect(u.drafts[0]).toMatchObject({
      sourceDetail: "Email bundle: application form, government ID, payslip",
      extracted: {
        fullName: "Grace Villamor",
        declaredMonthlyIncome: "56000.00",
        documentMonthlyIncome: "56000.00",
        amount: "120000.00",
        tenorMonths: 24,
      },
      matchedApplicant: { id: "APL-GRACE-VILLAMOR" },
      flags: [],
    });
  });

  it("INT-1 the same file cannot wait for review twice (409, nothing written); once its drafts are reviewed it can be uploaded again", async () => {
    const u = await spreadsheet();
    const before = await intakeState();
    const res = await upload("PARTNER_SPREADSHEET").expect(409);
    expect(res.body.code).toBe("CONFLICT");
    expect(res.body.detail).toContain("already waiting for review (3)");
    expect(await intakeState()).toEqual(before);
    for (const d of u.drafts) await discard(d.id, { reason: "Test reset" }).expect(200);
    await upload("PARTNER_SPREADSHEET").expect(201);
  });

  it("INT-1 two uploads of one file at once: the partial unique index refuses the second (409), mapped after the rollback", async () => {
    await spreadsheet();
    const before = await intakeState();
    // Force the race the pre-check cannot see: it reads no pending drafts.
    jest.spyOn(h.app.get(IntakeRepository), "pendingCount").mockResolvedValue(0);
    const res = await upload("PARTNER_SPREADSHEET").expect(409);
    expect(res.body.code).toBe("CONFLICT");
    expect(await intakeState()).toEqual(before);
  });

  it("INT-1 an OCR reading reference already on file is refused (409, the unique index, mapped after the rollback) and nothing is written", async () => {
    const first = (await upload("EMAIL_BUNDLE").expect(201)).body as IntakeUploadView;
    await discard(first.drafts[0]?.id as string, { reason: "Test reset" }).expect(200);
    const before = await intakeState();
    const ocr = h.app.get<DocumentExtraction>(DOCUMENT_EXTRACTION);
    const real = ocr.extractBundle.bind(ocr);
    jest
      .spyOn(ocr, "extractBundle")
      .mockImplementation(async (req) => ({ ...(await real(req)), reference: first.reference }));
    const res = await upload("EMAIL_BUNDLE").expect(409);
    expect(res.body).toMatchObject({ code: "CONFLICT" });
    expect(res.body.detail).toContain("already on file");
    expect(await intakeState()).toEqual(before);
  });

  it.each(["OUTAGE", "TIMEOUT", "MALFORMED"])(
    "INT-2 with OCR in %s the upload answers 503 in words, writes nothing, and works once OCR is back",
    async (mode) => {
      await setMode(h, "DOCUMENT_EXTRACTION", mode);
      const before = await intakeState();
      const res = await upload("EMAIL_BUNDLE").expect(503);
      expect(res.body.code).toBe("PROVIDER_UNAVAILABLE");
      expect(res.body.detail).toContain("capture the application by hand in New application");
      expect(await intakeState()).toEqual(before);
      await setMode(h, "DOCUMENT_EXTRACTION", "OK");
      await upload("EMAIL_BUNDLE").expect(201);
    },
  );

  it("INT-3 confirming a draft creates an ordinary case draft (not submitted) with the reviewed terms and its history; consent and submit follow the standard pipeline", async () => {
    const u = (await upload("EMAIL_BUNDLE").expect(201)).body as IntakeUploadView;
    const draft = u.drafts[0] as IntakeDraftView;
    const decisions = await count(h.ds, "SELECT count(*) AS n FROM decision_record");
    const res = await confirm(draft.id, {
      amount: "100000.00",
      tenorMonths: 24,
      purpose: "Home renovation",
    }).expect(200);
    const confirmed = res.body as IntakeDraftView;
    expect(confirmed).toMatchObject({
      status: "CONFIRMED",
      review: { byName: "Paolo Tan" },
      actions: [],
    });
    expect(confirmed.case?.reference).toMatch(/^APP-\d+$/);
    const caseId = confirmed.case?.id as string;

    const c = (await h.as("paolo").get(`/cases/${caseId}`).expect(200)).body as CaseDetail;
    expect(c).toMatchObject({
      status: "DRAFT",
      requestedAmount: "100000.00",
      requestedTenorMonths: 24,
      purpose: "Home renovation",
      applicant: { fullName: "Grace Villamor" },
      consent: null,
      decision: null,
    });
    // Never auto-submitted: no decision was made.
    expect(await count(h.ds, "SELECT count(*) AS n FROM decision_record")).toBe(decisions);
    const history = await activity(caseId);
    const intake = history.find((e) => e.action === "INTAKE_CONFIRMED");
    expect(history.map((e) => e.action)).toEqual(
      expect.arrayContaining(["CASE_CREATED", "INTAKE_CONFIRMED"]),
    );
    expect(intake?.summary).toContain("after review of the OCR draft (simulated");
    expect(intake?.details).toMatchObject({
      before: { amount: "120000.00", tenorMonths: 24 },
      after: { amount: "100000.00", tenorMonths: 24, purpose: "Home renovation" },
    });
    // The immutable audit copy names the batch, not the file (the sender's address), and keeps
    // the terms without the ID digits.
    const [audit] = await h.ds.query(
      "SELECT summary, details FROM audit_event WHERE action = 'INTAKE_CONFIRMED' AND case_id = $1",
      [caseId],
    );
    expect(audit.summary).toContain(u.reference);
    expect(JSON.stringify(audit)).not.toContain("g.villamor");
    expect(audit.details.after).toEqual({
      amount: "100000.00",
      tenorMonths: 24,
      purpose: "Home renovation",
    });

    // The standard pipeline: no consent, no submission (INT-006); then the decision runs.
    const refused = await h.as("paolo").post(`/cases/${caseId}/submit`).expect(400);
    expect(refused.body.errors[0].field).toBe("consent");
    await h.as("paolo").patch(`/cases/${caseId}`, { consent: FULL_CONSENT }).expect(200);
    const submitted = (await h.as("paolo").post(`/cases/${caseId}/submit`).expect(200))
      .body as CaseDetail;
    expect(submitted).toMatchObject({ status: "REVIEW", outcome: "REFER" });
    const record = (await h.as("paolo").get(`/cases/${caseId}/decision`).expect(200))
      .body as DecisionRecordView;
    expect(record).toMatchObject({ score: 612, grade: "C" });

    // Reviewed once: a second confirm or a discard is refused and writes nothing.
    const before = await intakeState();
    await confirm(draft.id, { amount: "100000.00", tenorMonths: 24, purpose: "x" }).expect(409);
    await discard(draft.id, { reason: "late" }).expect(409);
    expect(await intakeState()).toEqual(before);
  });

  it("INT-3 a draft OCR could not read the ID of needs the officer to complete it: missing 400, no match 400, the right digits confirm", async () => {
    const elmer = row(await spreadsheet(), "Elmer Santos");
    const terms = { amount: "70000.00", tenorMonths: 12, purpose: "Medical expenses" };
    const before = await intakeState();
    const missing = await confirm(elmer.id, terms).expect(400);
    expect(missing.body.errors[0]).toMatchObject({ field: "governmentIdLast4" });
    const wrong = await confirm(elmer.id, { ...terms, governmentIdLast4: "1111" }).expect(400);
    expect(wrong.body.errors[0].message).toContain(
      "Check the last 4 digits; if they are right, capture the customer with New or walk-in customer",
    );
    const notDigits = await confirm(elmer.id, { ...terms, governmentIdLast4: "12a4" }).expect(400);
    expect(notDigits.body.errors[0].field).toBe("governmentIdLast4");
    expect(await intakeState()).toEqual(before);
    const ok = (await confirm(elmer.id, { ...terms, governmentIdLast4: "6619" }).expect(200))
      .body as IntakeDraftView;
    expect(ok).toMatchObject({
      status: "CONFIRMED",
      matchedApplicant: { id: "APL-ELMER" },
    });
  });

  it("INT-3 reviewed terms outside the product are refused with field errors and nothing written", async () => {
    const joy = row(await spreadsheet(), "Joy Fernandez");
    const before = await intakeState();
    const res = await confirm(joy.id, {
      amount: "10000.00",
      tenorMonths: 48,
      purpose: " ",
    }).expect(400);
    expect(res.body.errors.map((e: { field: string }) => e.field).sort()).toEqual([
      "amount",
      "purpose",
      "tenorMonths",
    ]);
    expect(await intakeState()).toEqual(before);
  });

  it("INT-3 one open application per applicant (INT-007): a confirm for an applicant with an open case is refused naming it, and the draft keeps waiting", async () => {
    const open = await submitCase(
      h,
      { applicantId: "APL-RAMIL", amount: "50000.00", tenorMonths: 12 },
      { sameApplicant: true },
    );
    const ramil = row(await spreadsheet(), "Ramil Ocampo");
    const before = await intakeState();
    const res = await confirm(ramil.id, {
      amount: "50000.00",
      tenorMonths: 12,
      purpose: "Tuition",
    }).expect(409);
    expect(res.body.code).toBe("DUPLICATE_APPLICATION");
    expect(res.body.detail).toContain(open.reference);
    expect(await intakeState()).toEqual(before);

    // The race the pre-check cannot see: the INT-007 index refuses, mapped after the rollback.
    jest.spyOn(h.app.get(CasesRepository), "findOpenCase").mockResolvedValueOnce(null);
    const raced = await confirm(ramil.id, {
      amount: "50000.00",
      tenorMonths: 12,
      purpose: "Tuition",
    }).expect(409);
    expect(raced.body.code).toBe("DUPLICATE_APPLICATION");
    expect(raced.body.detail).toContain(open.reference);
    expect(await intakeState()).toEqual(before);
  });

  it("INT-4 discarding needs a reason, records who and why in the audit log, and the draft leaves the pending list", async () => {
    const joy = row(await spreadsheet(), "Joy Fernandez");
    const before = await intakeState();
    const blank = await discard(joy.id, { reason: "  " }).expect(400);
    expect(blank.body.errors[0].field).toBe("reason");
    expect(await intakeState()).toEqual(before);
    const res = (await discard(joy.id, { reason: "Applied at the branch already" }).expect(200))
      .body as IntakeDraftView;
    expect(res).toMatchObject({
      status: "DISCARDED",
      review: { byName: "Paolo Tan", discardReason: "Applied at the branch already" },
      case: null,
    });
    const [entry] = await h.ds.query(
      "SELECT summary, details FROM audit_event WHERE action = 'INTAKE_DRAFT_DISCARDED' ORDER BY seq DESC LIMIT 1",
    );
    expect(JSON.stringify(entry)).not.toContain("Applied at the branch already");
    expect(JSON.stringify(entry)).not.toContain("Joy Fernandez");
    expect(entry.details).toMatchObject({
      before: { status: "PENDING_REVIEW" },
      after: { status: "DISCARDED", reasonGiven: true },
    });
    const pending = (await h.as("paolo").get("/intake/drafts").expect(200))
      .body as IntakeDraftView[];
    expect(pending.map((d) => d.id)).not.toContain(joy.id);
    const all = (await h.as("paolo").get("/intake/drafts?view=all").expect(200))
      .body as IntakeDraftView[];
    expect(all.map((d) => d.id)).toContain(joy.id);
    await h.as("paolo").get("/intake/drafts?view=closed").expect(400);
  });

  it("INT-4 only the loan officer uploads, confirms or discards; Compliance reads with no actions; other roles 403; signed out 401; nothing changes", async () => {
    const u = await spreadsheet();
    const d = row(u, "Joy Fernandez");
    const before = await intakeState();
    const body = { amount: "90000.00", tenorMonths: 18, purpose: "Home repairs" };
    for (const persona of ["rina", "marco", "ella", "diane", "leo"] as const) {
      await h.as(persona).post("/intake/uploads", { source: "EMAIL_BUNDLE" }).expect(403);
      await h.as(persona).post(`/intake/drafts/${d.id}/confirm`, body).expect(403);
      await h.as(persona).post(`/intake/drafts/${d.id}/discard`, { reason: "x" }).expect(403);
    }
    for (const persona of ["rina", "marco", "ella", "leo"] as const) {
      await h.as(persona).get("/intake/drafts").expect(403);
      await h.as(persona).get(`/intake/drafts/${d.id}`).expect(403);
    }
    const anon = h.anonymous();
    await anon.get("/intake/drafts").expect(401);
    await anon.post("/intake/uploads").send({ source: "EMAIL_BUNDLE" }).expect(401);
    await anon.post(`/intake/drafts/${d.id}/confirm`).send(body).expect(401);
    expect(await intakeState()).toEqual(before);
    const listed = (await h.as("diane").get("/intake/drafts").expect(200))
      .body as IntakeDraftView[];
    expect(listed.map((x) => x.id)).toContain(d.id);
    expect(listed.every((x) => x.actions.length === 0)).toBe(true);
    const seen = (await h.as("diane").get(`/intake/drafts/${d.id}`).expect(200))
      .body as IntakeDraftView;
    expect(seen).toMatchObject({ status: "PENDING_REVIEW", actions: [] });
    await h.as("paolo").post("/intake/uploads", { source: "FAX" }).expect(400);
    expect(await intakeState()).toEqual(before);
  });
});

// --- OCR on received case documents ---------------------------------------------------------

/** A referred case with the given documents requested and uploaded (back in REVIEW). */
async function withDocuments(applicantId: string, documents: string[]): Promise<CaseDetail> {
  const c = await submitCase(h, { applicantId, amount: "200000.00", tenorMonths: 36 });
  expect(c.status).toBe("REVIEW");
  await h
    .as("paolo")
    .post(`/cases/${c.id}/info-request`, { documents, message: "Please upload.", dueInDays: 3 })
    .expect(200);
  for (const type of documents) {
    await h.as("paolo").post(`/cases/${c.id}/documents/${type}/upload`).expect(200);
  }
  return c;
}

const extract = (id: string, type: string) =>
  h.as("paolo").post(`/cases/${id}/documents/${type}/extract`);

const readingState = async (id: string) => ({
  readings: await count(h.ds, "SELECT count(*) AS n FROM document_extraction WHERE case_id = $1", [
    id,
  ]),
  events: await count(h.ds, "SELECT count(*) AS n FROM activity_event WHERE case_id = $1", [id]),
  case: await h.ds.query("SELECT status, version, decision_id FROM loan_case WHERE id = $1", [id]),
  decisions: await count(h.ds, "SELECT count(*) AS n FROM decision_record WHERE case_id = $1", [
    id,
  ]),
});

describe("OCR and statement analysis on case documents (OCR-1..OCR-4, PRD DOC-002, DOC-007)", () => {
  it("OCR-1 bank statements are read into a statement analysis compared with the application, stored with an event; the decision and status do not change", async () => {
    const c = await withDocuments("APL-JOEL", ["BANK_STATEMENTS_3M", "CERTIFICATE_OF_EMPLOYMENT"]);
    const listed = (await h.as("paolo").get(`/cases/${c.id}/extractions`).expect(200))
      .body as CaseExtractionsView;
    expect(listed.lines.map((l) => [l.documentType, l.extraction, l.extract?.enabled])).toEqual([
      ["BANK_STATEMENTS_3M", null, true],
      ["CERTIFICATE_OF_EMPLOYMENT", null, true],
    ]);
    const before = await readingState(c.id);
    const res = (await extract(c.id, "BANK_STATEMENTS_3M").expect(200)).body as CaseExtractionsView;
    const line = res.lines.find((l) => l.documentType === "BANK_STATEMENTS_3M");
    expect(line?.extraction).toMatchObject({
      providerMode: "SIMULATED",
      monthlyIncome: "56000.00",
      employer: "Pasig Digital Studio",
      statement: {
        salaryCredit: "56000.00",
        monthsWithSalary: 3,
        monthsCovered: 3,
        recurringObligations: "11000.00",
        averageDailyBalance: "33600.00",
        returnedItems: 0,
        riskyMerchants: false,
      },
      compared: {
        monthlyIncome: "56000.00",
        monthlyObligations: "11000.00",
        employer: "Pasig Digital Studio",
      },
      flags: [],
      extractedByName: "Paolo Tan",
    });
    expect(line?.extraction?.reference).toMatch(/^OCR-D-[0-9A-F]{8}$/);
    expect(line?.extract).toEqual({
      enabled: false,
      detail: "Bank statements, last 3 months has already been read with OCR.",
    });
    const after = await readingState(c.id);
    expect(after).toEqual({ ...before, readings: 1, events: before.events + 1 });
    const event = (await activity(c.id)).find((e) => e.action === "DOCUMENT_EXTRACTED");
    expect(event?.summary).toContain("Nothing flagged.");

    // A certificate of employment carries income and employer, no statement analysis.
    const coe = (await extract(c.id, "CERTIFICATE_OF_EMPLOYMENT").expect(200))
      .body as CaseExtractionsView;
    expect(coe.lines[1]?.extraction).toMatchObject({ monthlyIncome: "56000.00", statement: null });
  });

  it("OCR-2 a document whose income differs from the declared one by more than 15% is flagged (Dante Flores: 50,000 read, 65,000 declared)", async () => {
    const c = await withDocuments("APL-DANTE", ["CERTIFICATE_OF_EMPLOYMENT"]);
    const res = (await extract(c.id, "CERTIFICATE_OF_EMPLOYMENT").expect(200))
      .body as CaseExtractionsView;
    expect(res.lines[0]?.extraction).toMatchObject({
      monthlyIncome: "50000.00",
      compared: { monthlyIncome: "65000.00" },
      flags: ["INCOME_MISMATCH"],
    });
    const event = (await activity(c.id)).find((e) => e.action === "DOCUMENT_EXTRACTED");
    expect(event?.summary).toContain("Flagged: Income differs from the declared figure.");
  });

  it("OCR-3 refused with 409 and nothing written: read twice, not received yet, not requested, case not in review; the index backstop maps after the rollback", async () => {
    const c = await withDocuments("APL-JOEL", ["BANK_STATEMENTS_3M"]);
    await extract(c.id, "BANK_STATEMENTS_3M").expect(200);
    const before = await readingState(c.id);
    expect((await extract(c.id, "BANK_STATEMENTS_3M").expect(409)).body.detail).toContain(
      "already been read",
    );
    expect((await extract(c.id, "INCOME_TAX_RETURN").expect(409)).body.detail).toContain(
      "was not requested",
    );
    // The race the pre-check cannot see: it finds no reading, the unique index refuses.
    jest.spyOn(h.app.get(IntakeRepository), "extractions").mockResolvedValue([]);
    const raced = await extract(c.id, "BANK_STATEMENTS_3M").expect(409);
    expect(raced.body.detail).toContain("already been read with OCR");
    jest.restoreAllMocks();
    expect(await readingState(c.id)).toEqual(before);
    const total = await count(h.ds, "SELECT count(*) AS n FROM document_extraction");

    const waiting = await submitCase(h, {
      applicantId: "APL-JOEL",
      amount: "200000.00",
      tenorMonths: 36,
    });
    await h
      .as("paolo")
      .post(`/cases/${waiting.id}/info-request`, {
        documents: ["BANK_STATEMENTS_3M"],
        message: "Please upload.",
        dueInDays: 3,
      })
      .expect(200);
    expect((await extract(waiting.id, "BANK_STATEMENTS_3M").expect(409)).body.detail).toContain(
      "has not been received",
    );
    const moved = await withDocuments("APL-JOEL", ["BANK_STATEMENTS_3M"]);
    await h
      .as("paolo")
      .post(`/cases/${moved.id}/documents/BANK_STATEMENTS_3M/review`, { decision: "VERIFIED" })
      .expect(200);
    const listed = (await h.as("paolo").get(`/cases/${moved.id}/extractions`).expect(200))
      .body as CaseExtractionsView;
    expect(listed.lines[0]?.extract).toEqual({ enabled: true, detail: null });
    await h
      .as("paolo")
      .post(`/cases/${moved.id}/recommendation`, {
        type: "APPROVE",
        rationale: "Statements verified.",
      })
      .expect(200);
    const refused = await extract(moved.id, "BANK_STATEMENTS_3M").expect(409);
    expect(refused.body.detail).toBe("Documents are read with OCR while the case is in review.");
    expect(await count(h.ds, "SELECT count(*) AS n FROM document_extraction")).toBe(total);
  });

  it.each(["OUTAGE", "TIMEOUT", "MALFORMED"])(
    "OCR-4 with OCR in %s reading a document answers 503 (verify by eye), writes nothing, and works once OCR is back",
    async (mode) => {
      const c = await withDocuments("APL-JOEL", ["BANK_STATEMENTS_3M"]);
      await setMode(h, "DOCUMENT_EXTRACTION", mode);
      const before = await readingState(c.id);
      const res = await extract(c.id, "BANK_STATEMENTS_3M").expect(503);
      expect(res.body.detail).toContain("verify the document by eye");
      expect(await readingState(c.id)).toEqual(before);
      await setMode(h, "DOCUMENT_EXTRACTION", "OK");
      await extract(c.id, "BANK_STATEMENTS_3M").expect(200);
    },
  );

  it("OCR-4 only the loan officer reads documents; Compliance sees readings without the action; other roles 403 or 404; signed out 401; the database refuses changing a reading", async () => {
    const c = await withDocuments("APL-JOEL", ["BANK_STATEMENTS_3M"]);
    for (const persona of ["rina", "marco", "ella", "diane", "leo"] as const) {
      await h.as(persona).post(`/cases/${c.id}/documents/BANK_STATEMENTS_3M/extract`).expect(403);
    }
    await h.anonymous().post(`/cases/${c.id}/documents/BANK_STATEMENTS_3M/extract`).expect(401);
    await h.anonymous().get(`/cases/${c.id}/extractions`).expect(401);
    await h.as("marco").get(`/cases/${c.id}/extractions`).expect(403);
    // An approver sees only cases awaiting their approval: a case in review is not visible.
    await h.as("rina").get(`/cases/${c.id}/extractions`).expect(404);
    const none = "SELECT count(*) AS n FROM document_extraction WHERE case_id = $1";
    expect(await count(h.ds, none, [c.id])).toBe(0);
    await extract(c.id, "BANK_STATEMENTS_3M").expect(200);
    const seen = (await h.as("diane").get(`/cases/${c.id}/extractions`).expect(200))
      .body as CaseExtractionsView;
    expect(seen.lines[0]).toMatchObject({ extract: null });
    expect(seen.lines[0]?.extraction?.statement?.salaryCredit).toBe("56000.00");
    await expect(
      h.ds.query("UPDATE document_extraction SET flags = '[]' WHERE case_id = $1", [c.id]),
    ).rejects.toThrow(/insert-only/);
  });
});
