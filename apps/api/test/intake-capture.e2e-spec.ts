import { randomUUID } from "node:crypto";
import { ApplicantsService } from "@loan/base";
import { CUSTOMER_LOOKUP, type CustomerLookup } from "@loan/contracts";
import type { ActivityView, CaseDetail, IntakeDraftView, IntakeUploadView } from "@loan/core";
import { Money } from "@loan/core";
import { count, type Harness, resetData, setMode, startHarness } from "./support/harness";

/**
 * Email and file intake, batch 2 (PRD INT-010, INT-005): capturing the customer from a draft no
 * record matches, in the same step as confirming it (INT-6, INT-7); the File intake channel
 * (INT-8); more synthetic files and the terms flag (INT-9).
 */
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
  await resetData(h.ds);
  // Applicants outlive resetData: remove the ones made here, so every test (and every later
  // test file) finds the Makati Logistics people not on record, as the file means them to be.
  await h.ds.query(
    "DELETE FROM applicant WHERE full_name IN ('Marites Dela Paz', 'Rodel Pascual') OR id LIKE 'APL-HOLDER-%' OR id LIKE 'APL-LORNA-ABAD-%'",
  );
});

const upload = (source: string, sampleFile?: string) =>
  h.as("paolo").post("/intake/uploads", { source, ...(sampleFile ? { sampleFile } : {}) });
const confirm = (id: string, body: object) =>
  h.as("paolo").post(`/intake/drafts/${id}/confirm`, body);

async function makati(): Promise<IntakeUploadView> {
  return (await upload("PARTNER_SPREADSHEET", "MAKATI_LOGISTICS").expect(201))
    .body as IntakeUploadView;
}
const row = (u: IntakeUploadView, name: string) =>
  u.drafts.find((d) => d.extracted.fullName === name) as IntakeDraftView;

const MARITES_TERMS = { amount: "60000.00", tenorMonths: 12, purpose: "Appliance purchase" };
const NEW_CUSTOMER = { employmentMonths: 30, monthlyObligations: "4000.00" };

/** What a refused confirm must leave as it was. */
const state = async () => ({
  applicants: await count(h.ds, "SELECT count(*) AS n FROM applicant"),
  cases: await count(h.ds, "SELECT count(*) AS n FROM loan_case"),
  drafts: await h.ds.query("SELECT id, status, version FROM intake_draft ORDER BY id"),
  audit: await count(h.ds, "SELECT count(*) AS n FROM audit_event"),
});

async function activity(id: string): Promise<ActivityView[]> {
  return (await h.as("diane").get(`/cases/${id}/activity`).expect(200)).body as ActivityView[];
}

describe("more synthetic files (INT-9)", () => {
  it("INT-9 the officer picks a synthetic file per source; Makati Logistics' people are not on record and one asks for less than the product allows", async () => {
    const u = await makati();
    expect(u).toMatchObject({
      fileName: "Makati Logistics HR – loan requests Dec 2026.xlsx",
      rowCount: 2,
      flaggedCount: 2,
    });
    expect(row(u, "Marites Dela Paz")).toMatchObject({
      matchedApplicant: null,
      flags: ["NO_CUSTOMER_MATCH"],
    });
    expect(row(u, "Rodel Pascual")).toMatchObject({
      extracted: { amount: "15000.00", tenorMonths: 6 },
      flags: ["TERMS_OUTSIDE_PRODUCT", "NO_CUSTOMER_MATCH"],
    });
  });

  it("INT-9 Lorna Abad's payslip shows less than she declared: matched, flagged for income", async () => {
    const u = (await upload("EMAIL_BUNDLE", "ABAD").expect(201)).body as IntakeUploadView;
    expect(u.drafts[0]).toMatchObject({
      extracted: { declaredMonthlyIncome: "52000.00", documentMonthlyIncome: "41000.00" },
      matchedApplicant: { id: "APL-LORNA-ABAD" },
      flags: ["INCOME_MISMATCH"],
    });
  });

  it("INT-9 a file of another source, or one that does not exist, is refused (400) and nothing is written", async () => {
    const before = await state();
    for (const sampleFile of ["ABAD", "NO_SUCH_FILE"]) {
      const res = await upload("PARTNER_SPREADSHEET", sampleFile).expect(400);
      expect(res.body.errors[0].field).toBe("sampleFile");
    }
    expect(await state()).toEqual(before);
  });
});

describe("capture the customer from a draft (INT-6, INT-7, INT-8)", () => {
  it("INT-6, INT-8 confirming a draft no customer matches captures the applicant from it and the case draft, in one transaction, on the File intake channel", async () => {
    const marites = row(await makati(), "Marites Dela Paz");
    const before = await state();
    const res = await confirm(marites.id, { ...MARITES_TERMS, newCustomer: NEW_CUSTOMER }).expect(
      200,
    );
    const draft = res.body as IntakeDraftView;
    expect(draft).toMatchObject({ status: "CONFIRMED", applicantCaptured: true });
    const applicantId = draft.matchedApplicant?.id as string;
    expect(applicantId).toMatch(/^APL-W/);
    const [a] = await h.ds.query(
      `SELECT full_name, birth_date::text AS birth_date, government_id_last4, employer,
              employment_months, monthly_income, declared_monthly_income, monthly_obligations,
              customer_number, deposit_account
         FROM applicant WHERE id = $1`,
      [applicantId],
    );
    expect(a).toEqual({
      full_name: "Marites Dela Paz",
      birth_date: "1991-06-09",
      government_id_last4: "4417",
      employer: "Makati Logistics Corp.",
      employment_months: 30,
      monthly_income: "38000.00",
      declared_monthly_income: null,
      monthly_obligations: "4000.00",
      customer_number: null,
      deposit_account: "",
    });
    const c = (await h.as("paolo").get(`/cases/${draft.case?.id}`).expect(200)).body as CaseDetail;
    expect(c).toMatchObject({ status: "DRAFT", channel: "FILE_INTAKE", decision: null });
    const after = await state();
    expect(after.applicants).toBe(before.applicants + 1);
    expect(after.cases).toBe(before.cases + 1);
    const captured = await count(
      h.ds,
      "SELECT count(*) AS n FROM audit_event WHERE action = 'APPLICANT_CAPTURED' AND details->>'applicantId' = $1",
      [applicantId],
    );
    expect(captured).toBe(1);
    const event = (await activity(c.id)).find((e) => e.action === "INTAKE_CONFIRMED");
    expect(event?.details).toMatchObject({ applicantCaptured: true });
  });

  it("INT-6, INT-8 a draft matched to a customer on record keeps that customer and ignores the new-customer details; an application captured at the branch stays on the Branch channel", async () => {
    const u = (await upload("EMAIL_BUNDLE", "ABAD").expect(201)).body as IntakeUploadView;
    const before = await state();
    const res = await confirm(u.drafts[0]?.id as string, {
      amount: "100000.00",
      tenorMonths: 24,
      purpose: "Car repair",
      newCustomer: NEW_CUSTOMER,
    }).expect(200);
    const draft = res.body as IntakeDraftView;
    expect(draft).toMatchObject({
      applicantCaptured: false,
      matchedApplicant: { id: "APL-LORNA-ABAD" },
    });
    expect((await state()).applicants).toBe(before.applicants);
    const c = (await h.as("paolo").get(`/cases/${draft.case?.id}`).expect(200)).body as CaseDetail;
    expect(c.channel).toBe("FILE_INTAKE");
    const branch = (
      await h
        .as("paolo")
        .post("/cases", {
          applicantId: "APL-MARIA",
          amount: "50000.00",
          tenorMonths: 12,
          purpose: "Home improvement",
          submit: false,
        })
        .expect(201)
    ).body as CaseDetail;
    expect(branch.channel).toBe("BRANCH");
  });

  it("INT-6 a customer captured by hand meanwhile (after the pre-check, before the lock) is matched under the lock and used, not captured twice", async () => {
    const marites = row(await makati(), "Marites Dela Paz");
    // The race the pre-check cannot see: the walk-in lands after the applicant was built.
    const applicants = h.app.get(ApplicantsService);
    const real = applicants.buildApplicant.bind(applicants);
    let walkInId = "";
    // Once: the walk-in's own capture (inside) runs the real build.
    jest.spyOn(applicants, "buildApplicant").mockImplementationOnce(async (body) => {
      const built = await real(body);
      const walkIn = await h
        .as("paolo")
        .post("/applicants", {
          fullName: "Marites Dela Paz",
          birthDate: "1991-06-09",
          governmentIdLast4: "4417",
          employer: "Makati Logistics Corp.",
          employmentMonths: 30,
          monthlyIncome: "38000.00",
          monthlyObligations: "4000.00",
        })
        .expect(201);
      walkInId = walkIn.body.id;
      return built;
    });
    const res = await confirm(marites.id, { ...MARITES_TERMS, newCustomer: NEW_CUSTOMER }).expect(
      200,
    );
    expect(res.body).toMatchObject({
      applicantCaptured: false,
      matchedApplicant: { id: walkInId },
    });
    const maritesRecords = await count(
      h.ds,
      "SELECT count(*) AS n FROM applicant WHERE full_name = 'Marites Dela Paz'",
    );
    expect(maritesRecords).toBe(1);
  });

  it("INT-6 a capture by core customer number takes identity, account and verified income from core, and keeps the file's figure as declared", async () => {
    const marites = row(await makati(), "Marites Dela Paz");
    // Core knows the draft's person (no synthetic core customer is in a file, so it is stubbed).
    jest.spyOn(h.app.get<CustomerLookup>(CUSTOMER_LOOKUP), "find").mockResolvedValue({
      provider: "Core banking customer file (simulated)",
      mode: "SIMULATED",
      customerNumber: "CIF-TEST-4417",
      fullName: "Marites Dela Paz",
      birthDate: "1991-06-09",
      governmentIdLast4: "4417",
      employer: "Makati Logistics Corp.",
      employmentMonths: 30,
      monthlyIncome: Money.of("36500.00"),
      monthlyObligations: Money.of("4000.00"),
      relationshipMonths: 26,
      depositAccount: "WB-SAV-0999-4417",
    });
    const res = await confirm(marites.id, {
      ...MARITES_TERMS,
      newCustomer: { ...NEW_CUSTOMER, customerNumber: "CIF-TEST-4417" },
    }).expect(200);
    expect(res.body).toMatchObject({ applicantCaptured: true });
    const [a] = await h.ds.query(
      `SELECT customer_number, deposit_account, monthly_income, declared_monthly_income,
              relationship_months FROM applicant WHERE id = $1`,
      [res.body.matchedApplicant.id],
    );
    expect(a).toEqual({
      customer_number: "CIF-TEST-4417",
      deposit_account: "WB-SAV-0999-4417",
      monthly_income: "36500.00",
      declared_monthly_income: "38000.00",
      relationship_months: 26,
    });
  });

  it("INT-7 the ID digits OCR read cannot be replaced: different digits are refused (400 on governmentIdLast4) before any core call and nothing is written", async () => {
    const marites = row(await makati(), "Marites Dela Paz");
    const before = await state();
    const plain = await confirm(marites.id, {
      ...MARITES_TERMS,
      governmentIdLast4: "9999",
      newCustomer: NEW_CUSTOMER,
    }).expect(400);
    expect(plain.body.errors[0].field).toBe("governmentIdLast4");
    // With a customer number and core down: still the 400, so core was never asked.
    await setMode(h, "CUSTOMER_LOOKUP", "OUTAGE");
    const byNumber = await confirm(marites.id, {
      ...MARITES_TERMS,
      governmentIdLast4: "9999",
      newCustomer: { ...NEW_CUSTOMER, customerNumber: "CIF-100245" },
    }).expect(400);
    expect(byNumber.body.errors[0].field).toBe("governmentIdLast4");
    // A matched draft too: the officer cannot redirect it to another customer's digits.
    const abad = (await upload("EMAIL_BUNDLE", "ABAD").expect(201)).body as IntakeUploadView;
    const afterUpload = await state();
    const matched = await confirm(abad.drafts[0]?.id as string, {
      amount: "100000.00",
      tenorMonths: 24,
      purpose: "Car repair",
      governmentIdLast4: "4821",
    }).expect(400);
    expect(matched.body.errors[0].field).toBe("governmentIdLast4");
    expect(await state()).toEqual(afterUpload);
    expect(afterUpload.applicants).toBe(before.applicants);
    expect(afterUpload.cases).toBe(before.cases);
  });

  it("INT-7 several customers on record with the draft's identity: refused (409), never read as no match, both before and under the lock, nothing written", async () => {
    await h.ds.query(
      `INSERT INTO applicant SELECT (jsonb_populate_record(NULL::applicant, to_jsonb(a) ||
         jsonb_build_object('id', 'APL-LORNA-ABAD-' || substr(md5(random()::text), 1, 6)))).*
       FROM applicant a WHERE a.id = 'APL-LORNA-ABAD'`,
    );
    const u = (await upload("EMAIL_BUNDLE", "ABAD").expect(201)).body as IntakeUploadView;
    expect(u.drafts[0]).toMatchObject({
      matchedApplicant: null,
      flags: expect.arrayContaining(["SEVERAL_CUSTOMERS_MATCH"]),
    });
    expect(u.drafts[0]?.flags).not.toContain("NO_CUSTOMER_MATCH");
    // Not offered: discard only; a confirm posted anyway is refused below.
    expect(u.drafts[0]?.actions).toEqual(["DISCARD"]);
    const terms = { amount: "100000.00", tenorMonths: 24, purpose: "Car repair" };
    const before = await state();
    // No new-customer details: the match under the lock refuses.
    const underLock = await confirm(u.drafts[0]?.id as string, terms).expect(409);
    expect(underLock.body.detail).toContain("Several customer records match");
    expect(underLock.body.detail).toContain(
      "start the application from the right customer under New application",
    );
    // With them: the check before building refuses; no duplicate applicant is captured.
    const beforeBuild = await confirm(u.drafts[0]?.id as string, {
      ...terms,
      newCustomer: NEW_CUSTOMER,
    }).expect(409);
    expect(beforeBuild.body.detail).toContain("Several customer records match");
    expect(await state()).toEqual(before);
  });

  it("INT-7 without the new-customer details a draft no customer matches is refused (400 on newCustomer) and nothing is written", async () => {
    const marites = row(await makati(), "Marites Dela Paz");
    const before = await state();
    const res = await confirm(marites.id, MARITES_TERMS).expect(400);
    expect(res.body.errors[0].field).toBe("newCustomer");
    expect(res.body.errors[0].message).toContain(
      "months with the employer and monthly obligations",
    );
    expect(await state()).toEqual(before);
  });

  it("INT-7 bad new-customer details or terms are refused with field errors named for the dialog, and nothing is written", async () => {
    const u = await makati();
    const marites = row(u, "Marites Dela Paz");
    const before = await state();
    const negative = await confirm(marites.id, {
      ...MARITES_TERMS,
      newCustomer: { employmentMonths: -1, monthlyObligations: "x" },
    }).expect(400);
    expect(negative.body.errors.map((e: { field: string }) => e.field).sort()).toEqual([
      "newCustomer.employmentMonths",
      "newCustomer.monthlyObligations",
    ]);
    const unknown = await confirm(marites.id, {
      ...MARITES_TERMS,
      newCustomer: { ...NEW_CUSTOMER, customerNumber: "CIF-999999" },
    }).expect(400);
    expect(unknown.body.errors[0].field).toBe("newCustomer.customerNumber");
    // Core's customer CIF-100245 is Lorna Bautista, not the draft's person.
    const other = await confirm(marites.id, {
      ...MARITES_TERMS,
      newCustomer: { ...NEW_CUSTOMER, customerNumber: "CIF-100245" },
    }).expect(400);
    expect(other.body.errors[0]).toMatchObject({ field: "newCustomer.customerNumber" });
    expect(other.body.errors[0].message).toContain("another name, birth date or ID");
    // Rodel's file terms are under the product minimum: confirming them as read is refused.
    const outside = await confirm(row(u, "Rodel Pascual").id, {
      amount: "15000.00",
      tenorMonths: 6,
      purpose: "School supplies",
      newCustomer: NEW_CUSTOMER,
    }).expect(400);
    expect(outside.body.errors[0].field).toBe("amount");
    expect(await state()).toEqual(before);
  });

  it("INT-7 with core banking down a capture by customer number answers 503 and writes nothing; without a number it needs no core call", async () => {
    const marites = row(await makati(), "Marites Dela Paz");
    await setMode(h, "CUSTOMER_LOOKUP", "OUTAGE");
    const before = await state();
    const res = await confirm(marites.id, {
      ...MARITES_TERMS,
      newCustomer: { ...NEW_CUSTOMER, customerNumber: "CIF-100245" },
    }).expect(503);
    expect(res.body.code).toBe("PROVIDER_UNAVAILABLE");
    expect(await state()).toEqual(before);
    await confirm(marites.id, { ...MARITES_TERMS, newCustomer: NEW_CUSTOMER }).expect(200);
  });

  it("INT-7 a core customer already on file under another applicant: the unique index refuses the capture (409), mapped after the rollback, nothing written", async () => {
    const marites = row(await makati(), "Marites Dela Paz");
    // An applicant already holds this customer number (under another name, so no match).
    const holder = `APL-HOLDER-${randomUUID().slice(0, 8)}`;
    await h.ds.query(
      `INSERT INTO applicant SELECT (jsonb_populate_record(NULL::applicant, to_jsonb(a) ||
         jsonb_build_object('id', $1::text, 'customer_number', 'CIF-TEST-1'))).*
       FROM applicant a WHERE a.id = 'APL-MARIA'`,
      [holder],
    );
    // Core says the number is the draft's person. Forced: no synthetic core customer is.
    const applicants = h.app.get(ApplicantsService);
    const real = applicants.buildApplicant.bind(applicants);
    jest.spyOn(applicants, "buildApplicant").mockImplementation(async (body) => {
      const a = await real({ ...body, customerNumber: undefined });
      a.customerNumber = "CIF-TEST-1";
      return a;
    });
    const before = await state();
    const res = await confirm(marites.id, {
      ...MARITES_TERMS,
      newCustomer: { ...NEW_CUSTOMER, customerNumber: "CIF-TEST-1" },
    }).expect(409);
    expect(res.body.code).toBe("DUPLICATE_APPLICATION");
    expect(res.body.detail).toContain(holder);
    expect(await state()).toEqual(before);
  });
});
